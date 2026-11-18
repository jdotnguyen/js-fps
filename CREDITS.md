# Credits

Third-party assets in this project, with their licences. Add one entry per asset as it goes in.

## 3D models

| Asset | Author | Source | Licence | Used as |
|---|---|---|---|---|
| Zombie Walk | LostBoyz2078 | [Sketchfab](https://sketchfab.com/3d-models/zombie-walk-24fd963a21a14f4abc68fd8960f34069) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | Common infected body (`public/assets/models/infected/zombie_walk.glb`) |
| Ocean floor scene | teacherap123 | [Sketchfab](https://sketchfab.com/3d-models/ocean-floor-scene-fd31c0d3f120480f87701556aa80292e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Sea floor outside the station windows (`public/assets/models/seabed/ocean_floor_scene.glb`; textures downscaled, tiled by `src/render/fx/seabed.ts`) |
| Mechanic 1 | SidewalkNZ | [Sketchfab](https://sketchfab.com/3d-models/mechanic-1-e98955d94822456e96a03e692d3d8429) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | August Giles' body (`public/assets/models/squad/mechanic.glb`, bones renamed by `scripts/fix-mechanic-glb.mjs`) |
| doctor | Chenchanchong | [Sketchfab](https://sketchfab.com/3d-models/doctor-cd00f4c4b7714bb88f7c1af12a91cf6e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Dr. Tomas Okafor's body (`public/assets/models/squad/doctor.glb`, rebuilt from the 19.7 MB source by `scripts/fix-doctor-glb.mjs`: bones renamed, bind pose fixed, animation and unused data dropped, textures re-encoded) |
| Mujer 2 con bolsa | Roberto Domínguez (vmmaniac) | [Sketchfab](https://sketchfab.com/3d-models/mujer-2-con-bolsa-a194bc4db68741c0885c85cda87d3de2) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Priya Anand's body (`public/assets/models/squad/priya.glb`, built from the 24 MB unrigged scan by `scripts/fix-priya-glb.mjs`: bag dropped, decimated to about 14k triangles, given a skeleton and skin weights, texture re-encoded) |
| Kilo-class Submarine | spacelynxcanfly | [Sketchfab](https://sketchfab.com/3d-models/kilo-class-submarine-a573bceca8ae47ab81b881e7da83f436) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | The supply sub that docks in the intro (`public/assets/models/vehicles/kilo_submarine.glb`; material converted by `scripts/fix-kilo-glb.mjs`, framed by `src/render/fx/subModel.ts`) |

CC BY-NC: credit required, no commercial use. While this model ships, the game must stay free.
