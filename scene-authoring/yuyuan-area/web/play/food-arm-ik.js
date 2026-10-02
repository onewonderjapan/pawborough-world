// Bounded skin-surface CCD in model space. Translations and limb lengths stay fixed.
import {Matrix3,Quaternion,Vector3} from 'three';
const identity=new Quaternion();
export function solveFoodArm(avatar,side,target,{iterations=24,tolerance=.008}={}) {
  if (!['armL','armR'].includes(side) || !target?.isVector3 || !target.toArray().every(Number.isFinite)) return {ok:false,gap:null,iterations:0,reason:'invalid-target'};
  const rig=avatar.ensureFoodArmRig(),chain=rig?.bonesBySide?.[side];
  if(!chain)return {ok:false,gap:null,iterations:0,reason:'missing-rig'};
  const modelQ=new Quaternion(),parentQ=new Quaternion(),delta=new Quaternion(),local=new Quaternion();
  const pivot=new Vector3(),from=new Vector3(),to=new Vector3();
  const joints=[[chain.shoulder,2.1],[chain.forearm,2.2],[chain.wrist,.35]];
  let count=0,gap=avatar.getFoodPalm(side)?.distanceTo(target)??Infinity;
  const max=Math.max(1,Math.min(48,Math.floor(iterations)||24));
  for(;count<max&&gap>tolerance;count++) {
    for(const [joint,limit]of joints) {
      avatar.root.updateMatrixWorld(true);
      avatar.model.worldToLocal(joint.getWorldPosition(pivot));
      const contributions=avatar.getFoodPalmContributions?.(side);
      if (contributions) {
        const affected=contributions.filter(({bone})=>{for(let p=bone;p;p=p.parent)if(p===joint)return true;return false;});
        const mass=affected.reduce((m,v)=>m+v.mass,0);
        const effective=avatar.getFoodPalm(side).addScaledVector(pivot,mass);
        for(const c of affected)effective.sub(c.position);
        pivot.copy(effective);
      }
      from.copy(avatar.getFoodPalm(side)).sub(pivot);to.copy(target).sub(pivot);
      if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)continue;
      delta.setFromUnitVectors(from.normalize(),to.normalize());
      const angle=identity.angleTo(delta);
      if(angle>.35)delta.slerp(identity,1-.35/angle);
      avatar.model.getWorldQuaternion(modelQ);joint.parent.getWorldQuaternion(parentQ);
      parentQ.premultiply(modelQ.invert());
      local.copy(parentQ).invert().multiply(delta).multiply(parentQ);
      joint.quaternion.premultiply(local).normalize();
      const rest=avatar.restBoneQuaternions.get(joint.name)??identity;
      const deviation=rest.angleTo(joint.quaternion);
      if(deviation>limit)joint.quaternion.copy(rest.clone().slerp(joint.quaternion.clone(),limit/deviation));
      gap=avatar.getFoodPalm(side).distanceTo(target);
      if(gap<=tolerance)break;
    }
  }
  // Mixed non-arm weights mean the sampled skin centroid is not a rigid bone
  // endpoint. Refine with its measured Jacobian rather than that approximation.
  const axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
  for(let n=0;n<10&&gap>tolerance;n++) {
    const palm=avatar.getFoodPalm(side),q0=joints.map(([j])=>j.quaternion.clone()),columns=[];
    for(const [joint]of joints)for(const axis of axes) {
      const q=joint.quaternion.clone();joint.quaternion.multiply(new Quaternion().setFromAxisAngle(axis,.002));
      columns.push(avatar.getFoodPalm(side).sub(palm).multiplyScalar(500));joint.quaternion.copy(q);
    }
    const h=new Array(9).fill(0);h[0]=h[4]=h[8]=.0001;
    for(const v of columns){const a=v.toArray();for(let i=0;i<3;i++)for(let j=0;j<3;j++)h[i*3+j]+=a[i]*a[j];}
    const correction=target.clone().sub(palm).applyMatrix3(new Matrix3().set(...h).invert());
    const increments=columns.map(v=>Math.max(-.18,Math.min(.18,v.dot(correction))));
    let improved=false;
    for(const fraction of [1,.5,.25]) {
      for(let k=0;k<joints.length;k++) {
        const [joint,limit]=joints[k];joint.quaternion.copy(q0[k]);
        for(let a=0;a<3;a++)joint.quaternion.multiply(new Quaternion().setFromAxisAngle(axes[a],increments[k*3+a]*fraction));
        const rest=avatar.restBoneQuaternions.get(joint.name)??identity,angle=rest.angleTo(joint.quaternion);
        if(angle>limit)joint.quaternion.copy(rest.clone().slerp(joint.quaternion.clone(),limit/angle));
      }
      const candidate=avatar.getFoodPalm(side).distanceTo(target);
      if(candidate<gap){gap=candidate;improved=true;break;}
    }
    if(!improved){joints.forEach(([j],k)=>j.quaternion.copy(q0[k]));break;}
  }
  return {ok:Number.isFinite(gap)&&gap<=tolerance,gap,iterations:count,reason:gap<=tolerance?null:'unreachable'};
}
