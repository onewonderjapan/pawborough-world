"""Material setup for the handheld batch. Called inside Blender with geomlib imported as G.
All textures analytic (see kit/texlib.py + texture-authoring.json); no photo textures."""
from pathlib import Path
import bpy


def setup(G, tex_dir):
    G.TEX = Path(tex_dir)
    mat = G.mat
    mat('porcelain', 'white-porcelain', 'f2f0ea', .18)
    mat('rim', 'porcelain-blue-rim', '3a5a8c', .2)
    mat('dough', 'glutinous-dough', 'f3ede2', .38)
    mat('soup', 'clear-soup', 'd9d2c0', .08, alpha=.55)
    mat('osoup', 'osmanthus-sweet-soup', base='osmanthus-soup.jpg', rough=.08, source='texlib.py')
    mat('milk', 'soy-milk', 'f1e9d6', .15)
    mat('crust', 'fried-crust', base='fried-crust.jpg', rough=.5, tile=(.12, .12), source='texlib.py')
    mat('sesame', 'sesame-flatbread-top', base='sesame-top.jpg', rough=.55, source='texlib.py')
    mat('sesame-scallion', 'sesame-scallion-top', base='sesame-scallion.jpg', rough=.55, source='texlib.py')
    mat('pancake', 'scallion-pancake-top', base='scallion-pancake.jpg', rough=.5, source='texlib.py')
    mat('sauce', 'sweet-soy-glaze', '5a2a12', .12)
    mat('rib', 'braised-pork-rib', '6b3a1e', .3)
    mat('niangao', 'rice-cake-glazed', 'd9b98a', .22)
    mat('bamboo', 'bamboo-tray', 'c9a86a', .62)
    mat('weave', 'bamboo-weave', 'a88750', .72)
    mat('iron', 'dark-iron', '44453d', .64, .48)
    mat('steel', 'brushed-steel', '9da0a3', .35, .85)
    mat('glass', 'clear-glass-jar', 'f4f8f8', .02, alpha=.12)
    mat('beans-mass', 'bean-mass-lathe', base='bean-mass.jpg', rough=.6, tile=(.06, .06), source='texlib.py')
    mat('paper', 'kraft-paper', 'd8c39a', .9)
    mat('label', 'label-atlas', base='labels-atlas.png', rough=.7, clamp=True, source='typeset texlib.py')
    mat('amber', 'pear-syrup-candy', 'c78a2a', .15)
    mat('boxcard', 'paper-box-card', 'e7dcc4', .85)
    mat('wood', 'chopstick-wood', 'b48a5a', .6)
    mat('vinegar', 'dark-vinegar', '2a1810', .05)
    mat('tea', 'clay-teapot', '6e3f2a', .45)
    mat('tea-liquid', 'brewed-tea', '8a5a20', .1, alpha=.5)
    mat('greens', 'scallion-greens', '5c8a3a', .6)
    # beanskin: colour atlas on UVMap (per-variant cell) + wrinkle normal on second UV layer
    m = mat('beanskin', 'five-spice-bean-skin', base='bean-colour-atlas.jpg', rough=.72,
            normal='bean-wrinkle-normal.jpg', source='texlib.py analytic atlas+normal')
    n = m.node_tree.nodes
    l = m.node_tree.links
    uvn = n.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVNorm'
    for nd in n:
        if nd.type == 'TEX_IMAGE' and nd.image and 'normal' in (nd.image.name + (nd.image.filepath or '')).lower():
            l.new(uvn.outputs['UV'], nd.inputs['Vector'])
    G.META[m.name]['uvLayers'] = {'color': 'UVMap', 'normal': 'UVNorm'}
    # jar variant: same UV layout, 512px atlas (keeps the hero GLB under 2.5 MB)
    mj = mat('beanskin-jar', 'five-spice-bean-skin-jar', base='bean-colour-atlas-512.jpg', rough=.72,
             normal='bean-wrinkle-normal.jpg', source='texlib.py analytic atlas+normal (512)')
    nj = mj.node_tree.nodes
    lj = mj.node_tree.links
    uvnj = nj.new('ShaderNodeUVMap')
    uvnj.uv_map = 'UVNorm'
    for nd in nj:
        if nd.type == 'TEX_IMAGE' and nd.image and 'normal' in (nd.image.name + (nd.image.filepath or '')).lower():
            lj.new(uvnj.outputs['UV'], nd.inputs['Vector'])
    G.META[mj.name]['uvLayers'] = {'color': 'UVMap', 'normal': 'UVNorm'}
    return G.M
