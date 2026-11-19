# Credits

Third-party assets in this project, with their licences. Add one entry per asset as it goes in.

## 3D models

| Asset | Author | Source | Licence | Used as |
|---|---|---|---|---|
| Zombie Walk | LostBoyz2078 | [Sketchfab](https://sketchfab.com/3d-models/zombie-walk-24fd963a21a14f4abc68fd8960f34069) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | Common infected body (`public/assets/models/infected/zombie_walk.glb`) |
| Ocean floor scene | teacherap123 | [Sketchfab](https://sketchfab.com/3d-models/ocean-floor-scene-fd31c0d3f120480f87701556aa80292e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Sea floor outside the station windows (`public/assets/models/seabed/ocean_floor_scene.glb`; textures downscaled, tiled by `src/render/fx/seabed.ts`) |
| Mechanic 1 | SidewalkNZ | [Sketchfab](https://sketchfab.com/3d-models/mechanic-1-e98955d94822456e96a03e692d3d8429) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | August Giles' body (`public/assets/models/squad/mechanic.glb`, bones renamed by `scripts/fix-mechanic-glb.mjs`) |
| doctor | Chenchanchong | [Sketchfab](https://sketchfab.com/3d-models/doctor-cd00f4c4b7714bb88f7c1af12a91cf6e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Dr. Tomas Okafor's body (`public/assets/models/squad/doctor.glb`, rebuilt from the 19.7 MB source by `scripts/fix-doctor-glb.mjs`: bones renamed, bind pose fixed, animation and unused data dropped, textures re-encoded) |
| Modern Indian Woman | Pixel_Monster | [Sketchfab](https://sketchfab.com/3d-models/modern-indian-woman-830d8ed3236a4221862290b81807f408) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Priya Anand's body (`public/assets/models/squad/priya.glb`, compressed from the 20.6 MB source by `scripts/fix-priya-glb.mjs`: decimated to ~16.7k triangles, corneas and glasses lenses dropped, jaw bone and weights added, textures re-encoded) |
| Construction Worker In Safety Gear | restore50 | [Sketchfab](https://sketchfab.com/3d-models/construction-worker-in-safety-gear-f3d6999edb1e4cd99da2519c4d75bf2b) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Sung's body (`public/assets/models/squad/sung.glb`, built from the 17 MB unrigged scan by `scripts/fix-sung-glb.mjs`: blueprint tube trimmed, decimated to about 16k triangles, given a skeleton and skin weights, textures re-encoded) |
| Kilo-class Submarine | spacelynxcanfly | [Sketchfab](https://sketchfab.com/3d-models/kilo-class-submarine-a573bceca8ae47ab81b881e7da83f436) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | The supply sub that docks in the intro (`public/assets/models/vehicles/kilo_submarine.glb`; material converted by `scripts/fix-kilo-glb.mjs`, framed by `src/render/fx/subModel.ts`) |
| Location underground laboratory | bazz4r | [Sketchfab](https://sketchfab.com/3d-models/location-underground-laboratory-7f70eebd1f044277b91c197fb17c513e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Walkable lab sandbox (`?level=lab`; `public/assets/models/lab/`, built from the 18.6 MB source by `scripts/fix-lab-glb.mjs`: meshes merged into tiles, materials converted, box colliders baked, spawn and lamp points found; see `src/world/labWorld.ts`) |

CC BY-NC: credit required, no commercial use. While this model ships, the game must stay free.
