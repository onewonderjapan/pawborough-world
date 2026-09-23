from pathlib import Path
from PIL import Image,ImageFilter
import numpy as np,json
p=Path(__file__).parent/'textures';N=1024;rng=np.random.default_rng(117)
a=np.zeros((N,N,3),dtype=np.uint8)
for k in range(6):
 row,col=divmod(k,2);y0=round(row*N/3);y1=round((row+1)*N/3);h=y1-y0;w=N//2
 base=np.array([148+3*k,111+2*k,68+k])
 # Fine powder grains with soft, low-contrast concentration; no binary camouflage blobs.
 noise=np.asarray(Image.fromarray(rng.integers(65,190,(36,48),dtype=np.uint8)).resize((w,h),Image.Resampling.BICUBIC),float)/255
 grain=rng.normal(0,3,(h,w));powder=np.clip((noise-.22)*.26,0,.17)
 patch=base[None,None,:]*(1-powder[:,:,None])+np.array([224,211,178])[None,None,:]*powder[:,:,None]+grain[:,:,None]
 yy,xx=np.mgrid[0:h,0:w];u=xx/w;v=yy/h;hu=.25 if k%2==0 else .75
 band=np.exp(-((u-hu)/.017)**2)*np.exp(-((v-.5)/.17)**6)
 patch=patch*(1-band[:,:,None]*.52)
 a[y0:y1,col*w:(col+1)*w]=np.uint8(np.clip(patch,0,255))
im=Image.fromarray(a);im.save(p/'bean-colour-atlas.jpg',quality=92);im.resize((512,512),Image.Resampling.LANCZOS).save(p/'bean-colour-atlas-512.jpg',quality=92)
noise=Image.fromarray(rng.integers(60,196,(256,256),dtype=np.uint8)).resize((N,N),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(1))
height=np.asarray(noise,float)/255;gy,gx=np.gradient(height);normal=np.stack([.5-gx*.28,.5+gy*.28,np.ones_like(gx)],axis=-1)
Image.fromarray(np.uint8(np.clip(normal*255,0,255))).save(p/'bean-wrinkle-normal.jpg',quality=98)
print('Fine powder atlas and subtle normal saved')
