# Hero food authoring

Freeze inputs are in inputs/; source assets are restored using docs/FOOD-HERO-ASSETS-20261004.json. Existing game IDs, original8GLB hashes and world anchor positions are authoritative.

Run dough.py, crisps.py and wet.py inside Blender4.5 to generate authored low surfaces and static material maps, then finalize.py to restore frozenanchors, correct shape/bitereach, keep dense sources, bake NORMAL and export lowonly. Original generated files remain in versioned outbox. Normalbake is not enabled in the final bread/HarGow materials; their mesh normals avoid UV overlap artifacts.

Texture generation prompts are in prompts.json; generated source PNG/WebP live under ignored assets/ with independent outbox recovery. No paid provider/install is required. New local artifacts are not an automatic public deployment.
