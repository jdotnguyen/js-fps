/**
 * ElevenLabs Sound Effects generator for environmental ambience beds and one-shots.
 *
 * Reads `ELEVENLABS_API_KEY` from `.env` or the process environment (never logged or written to code),
 * generates seamless looping ambient beds (`loop: true`) and environmental foley one-shots into
 * `public/assets/audio/ambience/`, and verifies each file with `ffprobe` when available.
 *
 * Usage:
 *   npm run ambience:generate -- --list
 *   npm run ambience:generate -- --id hull_hum
 *   npm run ambience:generate -- --all
 *   npm run ambience:generate -- --all --force
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'public/assets/audio/ambience');
const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

export interface AmbienceAssetSpec {
  id: string;
  file: string;
  category: 'bed' | 'emitter' | 'oneshot';
  loop: boolean;
  duration: number;
  promptInfluence: number;
  prompt: string;
}

export const AMBIENCE_MANIFEST: readonly AmbienceAssetSpec[] = [
  // ---- Room ambient beds (10 presets authored in src/data/levels/slice01.json) ----
  {
    id: 'hull_hum',
    file: 'bed-hull-hum.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone inside a pressurized deep-sea steel research station hull, deep warm sub-bass ocean pressure outside thick steel walls, distant steady ship ventilation and generator vibration, subtle pressurized air circulation, dark industrial sci-fi horror atmosphere, no music, no voice, no melody, constant steady texture',
  },
  {
    id: 'commons_murmur',
    file: 'bed-commons-murmur.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet retro-industrial underwater station crew lounge and galley, gentle overhead HVAC airflow, distant soft refrigerator and kitchen equipment hum, warm enclosed hall acoustics, faint steel hull settling, no music, no speech, no voices, no melody, constant steady bed',
  },
  {
    id: 'lab_hum',
    file: 'bed-lab-hum.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a sterile underwater biological research laboratory, clean HEPA air filtration airflow, soft electronic cooling fans, subtle low hum of glass containment pumps and lab instruments, tense clinical sci-fi atmosphere, no music, no voice, no beeps, constant steady loop',
  },
  {
    id: 'hull_groan',
    file: 'bed-hull-groan.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless dark ambient bed of a deep-sea steel maintenance corridor under extreme ocean depth pressure, heavy low-frequency abyssal water rumble through metal bulkheads, faint tense metallic structural vibration, claustrophobic drafty air hum, survival horror atmosphere, no music, no voice, no sudden loud bangs, constant steady loop',
  },
  {
    id: 'office_hvac',
    file: 'bed-office-hvac.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet 1980s retro corporate security office inside an underwater facility, steady low overhead HVAC air conditioning vent hum, soft computer server and monitor fan whirr, subtle dry interior acoustics, muted background fluorescent hum, no music, no voice, no keyboard typing, constant steady loop',
  },
  {
    id: 'med_beeps',
    file: 'bed-med-bay.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet dimly lit medical bay on an underwater research station, sterile cleanroom ventilation airflow, soft medical refrigerator and diagnostic equipment hum, faint pressurized air whisper, eerie quiet hospital atmosphere, no music, no voice, no loud alarms, constant steady loop',
  },
  {
    id: 'water_drip',
    file: 'bed-flooded-tunnel.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of a dark flooded underground steel maintenance tunnel deep under the ocean, gentle dark water lapping and rippling softly against metal walls, sparse echoing water drips into standing puddles, heavy muffled underwater hull pressure rumble, cavernous damp acoustics, no music, no voice, constant steady loop',
  },
  {
    id: 'pipes_knock',
    file: 'bed-valve-room.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of an industrial pressurized water valve and pump room in an underwater facility, steady rushing water flowing through thick steel pipes, deep rhythmic mechanical pump vibration, subtle steam and pressure valve hiss, enclosed metallic acoustics, no music, no voice, constant steady loop',
  },
  {
    id: 'hydro_misters',
    file: 'bed-hydro-misters.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a humid enclosed sci-fi hydroponics greenhouse bay, gentle warm circulating grow-room HVAC ventilation airflow, subtle low grow-light fixture hum, damp enclosed greenhouse air without loud spraying water, calm working atmosphere, no music, no voice, no birds, constant steady loop',
  },
  {
    id: 'dive_drip',
    file: 'bed-dive-bay.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient soundscape of a cavernous deep-sea diving moon pool chamber, dark cold ocean water gently sloshing and lapping inside an open concrete and steel pool, soft echoing condensation drips, deep muffled underwater ocean surge, heavy pressurized chamber hum, no music, no voice, constant steady loop',
  },

  // ---- Positional / emitter loops (upgrade DemoRoomAudio & level emitters) ----
  {
    id: 'ventFan',
    file: 'emitter-vent-fan.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of an industrial metal wall ventilation duct exhaust fan spinning steadily, rushing air through steel grille slats, soft rhythmic mechanical motor hum and gentle blade flutter, no music, no voice',
  },
  {
    id: 'fluorescentBuzz',
    file: 'emitter-fluorescent-buzz.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.55,
    prompt:
      'close-up seamless loop of an aging overhead fluorescent tube light ballast humming and buzzing electrically with subtle occasional tiny filament crackle, raw realistic electrical sound, no music, no voice',
  },
  {
    id: 'waterRumble',
    file: 'emitter-water-rumble.mp3',
    category: 'emitter',
    loop: true,
    duration: 14,
    promptInfluence: 0.45,
    prompt:
      'seamless loop of deep abyssal ocean water pressure rumbling heavily against a thick reinforced underwater viewing window, dark muffled underwater current and subtle deep bubble turbulence, low sub-bass weight, no music, no voice',
  },
  {
    id: 'consoleHum',
    file: 'emitter-console-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of a vintage 1980s industrial computer terminal and CRT monitor humming softly, quiet internal cooling fan airflow and warm analog electronics power supply hum, no beeps, no music, no voice',
  },

  // ---- Environmental spatial one-shots (paced by AmbienceDirector & DemoRoomAudio) ----
  {
    id: 'hullGroan_1',
    file: 'oneshot-hull-groan-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 5.5,
    promptInfluence: 0.55,
    prompt:
      'deep eerie submarine steel hull groaning slowly under immense deep-ocean water pressure, resonant bending metal bulkhead stress creak, heavy sub-bass weight fading out naturally, sci-fi horror ambience foley, no music, no voice',
  },
  {
    id: 'hullGroan_2',
    file: 'oneshot-hull-groan-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.5,
    promptInfluence: 0.55,
    prompt:
      'distant muffled metallic hull pressure shift and slow low-pitched structural steel groan inside a deep underwater station, subtle stick-slip metal torsion, natural dark decay, no music, no voice',
  },
  {
    id: 'metalKnock_1',
    file: 'oneshot-metal-knock-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.6,
    prompt:
      'distant heavy muffled metallic clank and bulkhead knock echoing down an empty steel ship corridor, single thermal pipe expansion bang with dark metallic decay, no music, no voice',
  },
  {
    id: 'metalKnock_2',
    file: 'oneshot-metal-knock-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.2,
    promptInfluence: 0.6,
    prompt:
      'two subtle distant hollow metal pipe knocks in an underwater industrial facility, muffled heavy steel resonance fading into silence, realistic environmental foley, no music, no voice',
  },
  {
    id: 'creak_1',
    file: 'oneshot-creak-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.0,
    promptInfluence: 0.6,
    prompt:
      'subtle realistic metallic ceiling beam creak in a pressurized steel corridor, slow dry metal-on-metal tension groan, short natural tail, no music, no voice',
  },
  {
    id: 'creak_2',
    file: 'oneshot-creak-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.8,
    promptInfluence: 0.6,
    prompt:
      'short quiet steel bulkhead hinge and frame stress creak inside an old ship compartment, dry industrial metal groan, natural decay, no music, no voice',
  },
  {
    id: 'drip_1',
    file: 'oneshot-drip-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.8,
    promptInfluence: 0.65,
    prompt:
      'single crisp realistic water droplet falling into a shallow puddle inside a damp metal tunnel, clean resonant plink with brief wet room reflection, no music, no voice',
  },
  {
    id: 'drip_2',
    file: 'oneshot-drip-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.0,
    promptInfluence: 0.65,
    prompt:
      'two quick quiet condensation water drips landing on wet steel grating and puddle in a cavernous underwater tunnel, realistic foley, no music, no voice',
  },
  {
    id: 'pressurePing',
    file: 'oneshot-pressure-ping.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.55,
    prompt:
      'distant muffled deep-sea acoustic sonar ping heard faintly through a thick submarine steel hull underwater, lonely eerie underwater echo fading away, no music, no voice',
  },
  {
    id: 'distantMoan',
    file: 'oneshot-distant-moan.mp3',
    category: 'oneshot',
    loop: false,
    duration: 6.5,
    promptInfluence: 0.5,
    prompt:
      'eerie distant deep-ocean resonant moan from an enormous unseen creature far outside an underwater research station, heavily muffled through deep dark water and steel hull, low ominous sub-bass swell, no music, no voice',
  },
  {
    id: 'medBeep',
    file: 'oneshot-med-beep.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.65,
    prompt:
      'quiet clinical medical diagnostic monitor double soft electronic pulse beep in a quiet sterile hospital room, subtle muffled hospital equipment telemetry, no loud alarm, no music, no voice',
  },
  // Dock checkpoint (dock-checkpoint spec): the walk-through metal detector arch and the guard's hand wand.
  {
    id: 'archPass',
    file: 'oneshot-arch-pass.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.0,
    promptInfluence: 0.7,
    prompt:
      'single short soft two-tone electronic confirmation chime from a walk-through airport security metal detector, clean and friendly, slight metal room reverb, no alarm, no music, no voice',
  },
  {
    id: 'archAlarm',
    file: 'oneshot-arch-alarm.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.6,
    promptInfluence: 0.7,
    prompt:
      'walk-through airport security metal detector alarm, a fast repeating electronic warning beep for about one second, loud but not harsh, slight metal room reverb, no siren, no music, no voice',
  },
  {
    id: 'wandBeep',
    file: 'oneshot-wand-beep.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.7,
    prompt:
      'handheld security metal detector wand being swept over a person, quiet rising and falling electronic hum with two short soft beeps, close and dry, no alarm, no music, no voice',
  },
  // Dive bay launch hall (rebuild-dive-bay, dive-bay spec): the `launch_bay` bed and the trunk secure event.
  {
    id: 'ambLaunchBay',
    file: 'bed-launch-bay.mp3',
    category: 'bed',
    loop: true,
    duration: 20,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a large clean steel submersible launch hall inside a deep-sea research station, steady low hydraulic power pack hum, faint water moving and lapping deep inside a narrow steel shaft below the floor, distant ventilation airflow, calm working atmosphere, no music, no voice, no melody, constant steady loop',
  },
  {
    id: 'winchClunk',
    file: 'oneshot-winch-clunk.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.8,
    promptInfluence: 0.65,
    prompt:
      'single heavy deep metallic clunk of an industrial steel hoist winch lock engaging, followed by a brief low taut steel cable tension creak, inside a large metal hall with light reverb, slow heavy machinery foley, no rapid clicking, no music, no voice',
  },
  {
    id: 'trunkChirp',
    file: 'oneshot-trunk-chirp.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.7,
    prompt:
      'short industrial two-tone electronic warning chirp, two clean notes high then low, from a wall speaker in a large steel hall, slight reverb, not a siren, no music, no voice',
  },
  {
    id: 'trunkHatch',
    file: 'oneshot-trunk-hatch.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.5,
    promptInfluence: 0.55,
    prompt:
      'hydraulic rams whine steadily as a heavy steel pressure hatch slowly swings shut over four seconds, ending in a deep metallic clunk and a latch locking, large metal hall reverb, no music, no voice',
  },
  {
    id: 'trunkVent',
    file: 'oneshot-trunk-vent.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.0,
    promptInfluence: 0.6,
    prompt:
      'short pressurised air vent hiss tapering off quickly, followed by a few water drips into a steel shaft, metal hall reverb, no music, no voice',
  },
  {
    id: 'leakHiss',
    file: 'oneshot-leak-hiss.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.6,
    prompt:
      'thin irregular hissing steam leak from a pipe joint in a narrow dark metal corridor, two to three seconds, with a faint drip, close and dry, no music, no voice',
  },
  // Supply sub docking (intro-sequence spec, fix-supply-sub-docking): muffled underwater through the station hull.
  {
    id: 'subPass',
    file: 'oneshot-sub-pass.mp3',
    category: 'oneshot',
    loop: false,
    duration: 10.5,
    promptInfluence: 0.55,
    prompt:
      'deep heavily muffled underwater submarine gliding slowly into dock outside a thick steel research station hull, low sub-bass propulsion hum and slow propeller water displacement swelling gradually then easing to a stop, heard dimly through deep ocean water and thick pressure glass, dark realistic underwater foley, no bright highs, no sonar ping, no music, no voice',
  },
  {
    id: 'subClamp',
    file: 'oneshot-sub-clamp.mp3',
    category: 'oneshot',
    loop: false,
    duration: 6.0,
    promptInfluence: 0.6,
    prompt:
      'heavily muffled underwater hydraulic docking clamps closing and locking onto a submarine hull outside a deep-sea steel station, two seconds of low submerged hydraulic servo groan followed by heavy dull muffled steel thuds and a deep resonant sub-bass settle into underwater silence, heard through thick hull plating, no bright metallic ringing, no music, no voice',
  },
  // Hydroponics wing (hydroponics-misters-audio-and-crew): room beds, mister bursts, positional equipment loops, reactive alarm, interactions.
  {
    id: 'ambHydroVestibule',
    file: 'bed-hydro-vestibule.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a clean industrial biosecurity airlock vestibule in an underwater research station, steady filtered cleanroom air curtain and gentle overhead HEPA ventilation airflow, faint stainless steel room acoustics, calm sterile atmosphere, no music, no voice, no alarms, constant steady loop',
  },
  {
    id: 'ambHydroSeedLab',
    file: 'bed-hydro-seed-lab.mp3',
    category: 'bed',
    loop: true,
    duration: 16,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of a quiet sterile botanical seed propagation laboratory inside an underwater station, soft steady cooling hum of germination incubators and cold-storage seed vault, gentle cleanroom air circulation, crisp quiet glass-walled lab acoustics, no music, no voice, no beeps, constant steady loop',
  },
  {
    id: 'ambHydroPlantRoom',
    file: 'bed-hydro-plant-room.mp3',
    category: 'bed',
    loop: true,
    duration: 18,
    promptInfluence: 0.45,
    prompt:
      'seamless ambient room tone of an industrial hydroponics nutrient mixing and climate control plant room inside an underwater facility, steady warm low mechanical compressor hum, gentle fluid circulation through pressurized plastic and steel pipes, subtle exhaust fan airflow, enclosed tiled utility room acoustics, no music, no voice, no loud bangs, constant steady loop',
  },
  {
    id: 'ambHydroStoreroom',
    file: 'bed-hydro-storeroom.mp3',
    category: 'bed',
    loop: true,
    duration: 14,
    promptInfluence: 0.45,
    prompt:
      'seamless quiet ambient room tone of a small enclosed utility storeroom inside a deep-sea station, very soft distant muffled station ventilation hum behind thick walls, still intimate enclosed air, calm quiet atmosphere, no music, no voice, no water spray, constant steady loop',
  },
  {
    id: 'misterValve_1',
    file: 'oneshot-mister-valve-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.9,
    promptInfluence: 0.65,
    prompt:
      'crisp realistic mechanical brass solenoid irrigation valve clicking open with a brief pressurized water line thump and initial micro-hiss, greenhouse overhead misting rail foley, light hall reverb, no music, no voice',
  },
  {
    id: 'misterValve_2',
    file: 'oneshot-mister-valve-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.9,
    promptInfluence: 0.65,
    prompt:
      'short realistic industrial pneumatic water solenoid valve snapping open with a subtle metallic clack and sudden pressure release into a pipe, hydroponic mister rail foley, light room reverb, no music, no voice',
  },
  {
    id: 'misterSpray_1',
    file: 'oneshot-mister-spray-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.6,
    prompt:
      'realistic fine high-pressure greenhouse misting nozzles spraying a soft steady cloud of atomized water mist for three seconds then tapering off cleanly as the valve closes, crisp airy water aerosol hiss in a large metal-and-glass grow hall, no loud splash, no music, no voice',
  },
  {
    id: 'misterSpray_2',
    file: 'oneshot-mister-spray-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.6,
    prompt:
      'realistic overhead hydroponic fine-mist sprayers hissing steadily with delicate pressurized water vapor for three seconds before smoothly shutting off with a faint valve click, humid indoor greenhouse acoustics, no rainstorm, no music, no voice',
  },
  {
    id: 'misterSputter',
    file: 'oneshot-mister-sputter.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.2,
    promptInfluence: 0.65,
    prompt:
      'faulty greenhouse overhead water misting nozzle sputtering with two quick pressurized coughs and a brief uneven aerosol mist hiss before cutting off with a dry solenoid click, realistic hydroponics foley, light hall reverb, no music, no voice',
  },
  {
    id: 'hydroTrickle',
    file: 'emitter-hydro-trickle.mp3',
    category: 'emitter',
    loop: true,
    duration: 12,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of gentle recirculating water trickling and softly gurgling through shallow indoor hydroponic grow troughs and plastic drain pipes, calm continuous indoor water flow, quiet and steady, no loud waterfall, no music, no voice',
  },
  {
    id: 'dehumidifierHum',
    file: 'emitter-dehumidifier-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of an industrial commercial dehumidifier and HVAC air handler running steadily, low rhythmic compressor hum and steady blower fan airflow through metal louver vents, realistic utility room machinery, no alarm, no music, no voice',
  },
  {
    id: 'fertigationPump',
    file: 'emitter-fertigation-pump.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.5,
    prompt:
      'close-up seamless loop of a quiet industrial hydroponic liquid dosing pump and slow vertical tank agitator motor churning nutrient solution inside a large polyethylene tank, gentle rhythmic low motor pulse and muffled fluid circulation, no loud splash, no music, no voice',
  },
  {
    id: 'kettleSimmer',
    file: 'emitter-kettle-simmer.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.55,
    prompt:
      'close-up seamless loop of a small countertop stainless electric kettle gently simmering on keep-warm, very soft delicate bubbling water murmur and faint warm steam whisper, cozy quiet room foley, no whistle, no music, no voice',
  },
  {
    id: 'humidityAlarm',
    file: 'oneshot-humidity-alarm.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.7,
    prompt:
      'soft industrial climate control panel humidity fault warning chirp, two short muted amber-alert electronic beeps from a wall-mounted dehumidifier cabinet in a tiled utility room, realistic subtle telemetry alert, not harsh, not a loud siren, no music, no voice',
  },
  {
    id: 'hydroDrip_1',
    file: 'oneshot-hydro-drip-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.9,
    promptInfluence: 0.65,
    prompt:
      'two soft realistic condensation water droplets falling off broad wet plant leaves onto damp steel floor grating in an indoor greenhouse bay, gentle crisp foliage drip foley, light hall reverb, no music, no voice',
  },
  {
    id: 'hydroDrip_2',
    file: 'oneshot-hydro-drip-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.9,
    promptInfluence: 0.65,
    prompt:
      'single realistic water drop dripping from an overhead hydroponic misting pipe onto a wet plastic plant tray and leaf, delicate indoor greenhouse foley with light natural tail, no music, no voice',
  },
  {
    id: 'hydroLogSign',
    file: 'oneshot-hydro-log-sign.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.1,
    promptInfluence: 0.7,
    prompt:
      'crisp 1980s industrial hydroponics workstation terminal confirmation chime, soft tactile key click followed by a warm clean ascending two-note electronic log-saved tone, close realistic office equipment foley, no music, no voice',
  },
  {
    id: 'hydroAlarmReset',
    file: 'oneshot-hydro-alarm-reset.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.4,
    promptInfluence: 0.7,
    prompt:
      'industrial climate control console button press followed by a solid mechanical relay clunk and a calm resolving descending-to-neutral electronic acknowledgment chime as a humidity fault alarm clears, realistic utility room foley, no music, no voice',
  },
  // ---- Flooded tunnel and pump room (openspec overhaul-flooded-tunnel) ----
  {
    id: 'waterSlosh',
    file: 'emitter-water-slosh.mp3',
    category: 'emitter',
    loop: true,
    duration: 6,
    promptInfluence: 0.55,
    prompt:
      'seamless loop of a person wading slowly through knee-deep murky standing water in a narrow steel maintenance tunnel, continuous gentle sloshing and water swirling around legs, soft wet drag, close perspective, no music, no voice, no footsteps on hard floor, constant steady texture',
  },
  {
    id: 'pipePour',
    file: 'emitter-pipe-pour.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.55,
    prompt:
      'seamless loop of water pouring steadily from a burst overhead steel pipe into a pool of standing water below, heavy splattering stream hitting the surface, churning bubbling water, metallic pipe resonance, enclosed concrete tunnel, no music, no voice, constant steady texture',
  },
  {
    id: 'waterLap',
    file: 'emitter-water-lap.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.5,
    prompt:
      'seamless loop of small ripples lapping softly against a steel wall in a flooded underground tunnel, quiet slow wet slaps and gurgles, very gentle, still water, no music, no voice, constant steady texture',
  },
  {
    id: 'pumpRoom',
    file: 'emitter-pump-room.mp3',
    category: 'emitter',
    loop: true,
    duration: 10,
    promptInfluence: 0.5,
    prompt:
      'seamless loop of old industrial water pumps running in a small steel pump room aboard an underwater station, deep rhythmic motor drone, valve chatter, water rushing through large pipes, low mechanical vibration, no music, no voice, constant steady texture',
  },
  {
    id: 'klaxon',
    file: 'emitter-klaxon.mp3',
    category: 'emitter',
    loop: true,
    duration: 4,
    promptInfluence: 0.6,
    prompt:
      'seamless loop of an industrial emergency klaxon alarm horn inside a steel pump room, slow repeating two-second low harsh horn blasts, metallic room reverb, no music, no voice, constant steady repetition',
  },
  {
    id: 'sparkHiss_1',
    file: 'oneshot-spark-hiss-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1,
    promptInfluence: 0.6,
    prompt:
      'single small electrical spark falling into water and fizzling out, short sharp hiss and tiny sizzle, close, dry, no music, no voice',
  },
  {
    id: 'sparkHiss_2',
    file: 'oneshot-spark-hiss-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1,
    promptInfluence: 0.6,
    prompt:
      'a few hot electrical sparks dropping onto a wet surface and hissing briefly, quick crackling sizzle that dies away, close, no music, no voice',
  },
  {
    id: 'tubeStrike',
    file: 'oneshot-tube-strike.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.6,
    prompt:
      'a failing fluorescent tube light struggling to strike, ballast ticking and buzzing, two quick electric flutters then a steady hum, industrial ceiling fixture, no music, no voice',
  },
  {
    id: 'floodDoorSlam',
    file: 'oneshot-flood-door-slam.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.6,
    prompt:
      'a heavy steel pressure door slamming shut with a deep hydraulic thud and metal clang while water rushes behind it, muffled slosh after the slam, sealed hatch locking, no music, no voice',
  },
  {
    id: 'valveTurn',
    file: 'oneshot-valve-turn.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.65,
    prompt:
      'a large rusted iron valve wheel being forced open by hand, heavy metal grinding and squealing as it turns two full turns, gritty ratcheting stem, a final clunk as it opens and water pressure rushing in the pipe, close, industrial pump room, no music, no voice',
  },
  {
    id: 'creatureCharge',
    file: 'oneshot-creature-charge.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3,
    promptInfluence: 0.6,
    prompt:
      'a horrifying infected human creature shrieking as it charges, wet torn throat, raw guttural scream rising to a screech, splashing through water as it runs, echoing in a concrete tunnel, horror, no music',
  },
  {
    id: 'doorPound',
    file: 'oneshot-door-pound.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3,
    promptInfluence: 0.65,
    prompt:
      'fists violently pounding on the far side of a heavy sealed steel pressure door, three hard banging hits, muffled by water, deep metallic thuds resonating through the hatch, horror, no music, no voice',
  },
  {
    id: 'creatureSeverShriek',
    file: 'oneshot-creature-sever-shriek.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3,
    promptInfluence: 0.6,
    prompt:
      'a heavy steel door slamming shut and crunching through flesh and bone, wet snap, then an infected creature screaming in agony, an ear-splitting raw shriek that cracks and gurgles, very loud and close, horror, no music',
  },
  {
    id: 'ambushSting',
    file: 'oneshot-ambush-sting.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.5,
    promptInfluence: 0.6,
    prompt:
      'sudden horror movie jump scare stinger, a violent dissonant orchestral string stab with a huge metallic impact, then frantic shrieking violins and a pounding low drum pulse that fades, very loud, cinematic horror',
  },
  // The valve cutscene's slam (flooded-tunnel design D13): one hit, fired on the step that seals the door. The generated
  // impact lands about 0.03 s in; after generating, pad it so the impact sits at 0.9 s (the door's slide):
  //   ffmpeg -i raw.mp3 -af "adelay=870:all=1" -c:a libmp3lame -b:a 128k oneshot-flood-slam-hit.mp3
  // The Lab B score plays under it.
  {
    id: 'floodSlamHit',
    file: 'oneshot-flood-slam-hit.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4,
    promptInfluence: 0.7,
    prompt:
      'horror film score stinger: a very short fast string and brass crescendo rising for under one second into a single enormous orchestral impact hit, huge low drum and metallic boom together, then a long ringing low tail that fades, one hit only, no repeats, cinematic, no voice',
  },
  // The elite's blades forcing the sealed R09-R10 door apart from the middle (r10_ambush).
  {
    id: 'doorPry',
    file: 'oneshot-door-pry.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.65,
    prompt:
      'heavy steel sliding pressure door being forced apart from the middle by a monster, metal blades scraping and grinding in the seam, door leaves screeching open a little against straining hydraulics, groaning metal, close, industrial, horror, no music, no voice',
  },
  {
    id: 'alarmBlast',
    file: 'oneshot-alarm-blast.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3,
    promptInfluence: 0.65,
    prompt:
      'a very loud industrial emergency evacuation alarm klaxon blaring twice in a small steel pump room, harsh low horn, metallic room echo, no music, no voice',
  },
  {
    id: 'bodyDrip',
    file: 'oneshot-body-drip.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.55,
    prompt:
      'water dripping and running off wet clothes and boots onto a steel deck after climbing out of water, brief patter of drips slowing down, close, no music, no voice',
  },
  // Station blackout (station-power spec): the drop's lockdown alarm, the mains failing, and the backup lamps.
  {
    id: 'lockdownAlarm',
    file: 'oneshot-lockdown-alarm.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.6,
    promptInfluence: 0.6,
    prompt:
      'one cycle of a heavy industrial emergency evacuation alarm in a deep-sea steel research station, loud deep two-tone klaxon horn with a hard attack, metallic resonant tail ringing through steel corridors, serious real emergency, no music, no voice, no synth beeps',
  },
  {
    id: 'powerDown',
    file: 'oneshot-power-down.mp3',
    category: 'oneshot',
    loop: false,
    duration: 5,
    promptInfluence: 0.55,
    prompt:
      'main power failing across a large underwater steel facility, heavy electrical relays clunking off one after another, big generators spooling down with a falling whine, fluorescent hum dying out into silence, a distant metallic thud, no music, no voice',
  },
  {
    id: 'backupHum',
    file: 'emitter-backup-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 8,
    promptInfluence: 0.5,
    prompt:
      'seamless close-up loop of a low electrical mains ballast hum from an emergency backup lamp, steady 50 hertz buzz with a faint transformer whine, quiet, constant, no music, no voice, no clicks',
  },
  // The Lab B creature escaping through the vents (trim-lab-wing-encounters design D6): heard tearing off Lab B's grate
  // in the blackout, crawling along the ducts over R05 and R06, then kicking out R06's grate and landing.
  {
    id: 'ventCoverRip',
    file: 'oneshot-vent-cover-rip.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'a metal ceiling ventilation grate violently torn off its frame by a monster in the dark, screws shearing, sheet metal bending and screeching, the grate swinging and clanging on one hinge, close, horror, no music, no voice',
  },
  {
    id: 'ventCoverBurst',
    file: 'oneshot-vent-cover-burst.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.5,
    promptInfluence: 0.7,
    prompt:
      'a ceiling vent grate violently kicked out from inside the duct by a heavy monster, a single huge metal bang and a shriek of bending sheet metal, close, industrial, horror, no music, no voice',
  },
  {
    id: 'ductBang_1',
    file: 'oneshot-duct-bang-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'a heavy creature crawling inside a sheet-metal ventilation duct above a ceiling, two slow heavy body-weight bangs, hollow metallic thuds and the duct flexing and booming, muffled through the ceiling, close, horror, no music, no voice',
  },
  {
    id: 'ductBang_2',
    file: 'oneshot-duct-bang-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'a heavy creature crawling inside a sheet-metal ventilation duct above a ceiling, a single hard knock and a dent popping, hollow metallic thuds and the duct flexing and booming, muffled through the ceiling, close, horror, no music, no voice',
  },
  {
    id: 'ductBang_3',
    file: 'oneshot-duct-bang-3.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'a heavy creature crawling inside a sheet-metal ventilation duct above a ceiling, three fast scrambling bangs moving along, hollow metallic thuds and the duct flexing and booming, muffled through the ceiling, close, horror, no music, no voice',
  },
  {
    id: 'ductBang_4',
    file: 'oneshot-duct-bang-4.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'a heavy creature crawling inside a sheet-metal ventilation duct above a ceiling, a heavy lurching thump and a long metal groan, hollow metallic thuds and the duct flexing and booming, muffled through the ceiling, close, horror, no music, no voice',
  },
  {
    id: 'ductScrape_1',
    file: 'oneshot-duct-scrape-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.65,
    prompt:
      'claws and a body dragging along the inside of a sheet-metal air duct, long metallic scraping and squealing, muffled through a ceiling, horror, no music, no voice',
  },
  {
    id: 'ductScrape_2',
    file: 'oneshot-duct-scrape-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2,
    promptInfluence: 0.65,
    prompt:
      'quick skittering claws scratching inside a metal ventilation duct overhead, short scrape and a hollow knock, muffled, horror, no music, no voice',
  },
  {
    id: 'creatureLand_1',
    file: 'oneshot-creature-land-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.5,
    promptInfluence: 0.7,
    prompt:
      'a heavy wet monster body dropping from a ceiling and slamming flat onto a steel deck plate floor, a deep thud with a flesh slap and metal ring, close, horror, no music, no voice',
  },
  {
    id: 'creatureLand_2',
    file: 'oneshot-creature-land-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.5,
    promptInfluence: 0.7,
    prompt:
      'a large creature landing hard on a metal floor from a height, heavy body impact, bones cracking, deck plating booming, close, horror, no music, no voice',
  },
  {
    id: 'grateClatter',
    file: 'oneshot-grate-clatter.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.5,
    promptInfluence: 0.7,
    prompt:
      'a metal ventilation grate falling from a ceiling and clattering onto a steel floor, bouncing twice and rattling to a stop, close, industrial, no music, no voice',
  },
  // overhaul-priya-r08-death D25/D31: the medbay intercom's switch and static, and the vitals monitor's steady beep.
  {
    id: 'intercomClick',
    file: 'oneshot-intercom-click.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.5,
    promptInfluence: 0.7,
    prompt:
      'a single hard click of an old intercom push-to-talk switch through a small wall loudspeaker, tiny speaker pop, dry, no music, no voice',
  },
  {
    id: 'intercomStatic',
    file: 'oneshot-intercom-static.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.2,
    promptInfluence: 0.65,
    prompt:
      'a short burst of loudspeaker static as a room intercom channel opens, harsh crackle and hiss that settles to a faint hum, small wall speaker, dry, no music, no voice',
  },
  {
    id: 'monitorBeep',
    file: 'oneshot-monitor-beep.mp3',
    category: 'oneshot',
    loop: false,
    duration: 0.5,
    promptInfluence: 0.75,
    prompt:
      'one single short clean electronic heart monitor beep, a pure soft sine tone, hospital vital signs monitor, one beep only, dry, no music, no voice',
  },
  // detail-r11-power-bay: R11 Power Bay switchgear breaker throw, turbine spin-up, and continuous generator hum.
  {
    id: 'breaker_clunk',
    file: 'oneshot-breaker-clunk.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.0,
    promptInfluence: 0.7,
    prompt:
      'heavy industrial high voltage electrical switchgear breaker throwing shut, deep metallic mechanical clunk followed by a crisp spring latch snap and brief electrical contact arc hum, dry, close, no music, no voice',
  },
  {
    id: 'turbine_spinup',
    file: 'oneshot-turbine-spinup.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.0,
    promptInfluence: 0.65,
    prompt:
      'large deep-sea industrial power plant turbine generator starting up and accelerating, deep heavy mechanical bearing rumble and rising turbine whine settling toward steady power, enclosed steel hall, no music, no voice',
  },
  {
    id: 'generator_hum',
    file: 'emitter-generator-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 12,
    promptInfluence: 0.55,
    prompt:
      'seamless steady hum of a large industrial electrical power generator and turbine running at speed inside a deep-sea steel power bay, low 60 hertz transformer drone and smooth mechanical turbine whirr, constant steady loop, no music, no voice',
  },
  {
    id: 'generatorPhase1',
    file: 'oneshot-generator-phase-1.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.55,
    prompt:
      'heavy industrial switchgear relay thump followed by a deep muffled low-frequency sub-bass turbine generator beginning to rumble and spool up inside a steel deep-sea power room, mechanical inertia, dark sci-fi facility, no music, no voice',
  },
  {
    id: 'generatorPhase2',
    file: 'oneshot-generator-phase-2.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.5,
    promptInfluence: 0.55,
    prompt:
      'heavy high-voltage power bus engagement clunk followed by a deeper, heavier layered twin industrial turbine generator rumble climbing in resonant low-end bass weight inside a pressurized steel power plant, no music, no voice',
  },
  {
    id: 'generatorPhase3',
    file: 'oneshot-generator-phase-3.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.0,
    promptInfluence: 0.55,
    prompt:
      'massive industrial breaker lock-in followed by full-load subsea power plant turbines reaching operating speed with a deep resonant sub-bass rumble and steady 60 hertz electrical transformer hum settling in, no music, no voice',
  },
  {
    id: 'heavyBulkheadOpen',
    file: 'oneshot-heavy-bulkhead-open.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.6,
    promptInfluence: 0.55,
    prompt:
      'massive heavy steel submarine bulkhead blast door slowly unlocking with a deep metallic latch clunk and pressurized hydraulic air release, then grinding slowly open on heavy steel tracks with resonant low-frequency weight and a final heavy mechanical stop thud, dark sci-fi industrial facility, no music, no voice',
  },
  {
    id: 'powerBayHum',
    file: 'emitter-power-bay-hum.mp3',
    category: 'emitter',
    loop: true,
    duration: 14,
    promptInfluence: 0.6,
    prompt:
      'loud deep resonant low-bass hum of massive industrial subsea electrical turbines and heavy high-voltage power transformers running at full load inside a steel generator hall, rich rumbling 60 hertz sub-bass drone with warm mechanical vibration and steady power-plant thrumming, seamless constant loop, no music, no voice',
  },
  // R15a Departure Bay & 3-stage abyssal transit ride (r15a-train-ride-narrative).
  {
    id: 'trainDoorClose',
    file: 'oneshot-train-door-close.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.8,
    promptInfluence: 0.65,
    prompt:
      'heavy industrial pressurized subway transit train sliding door closing with a crisp pneumatic air hiss, metallic slide along steel rails, and a firm solid mechanical latch lock clunk inside a steel cabin, realistic foley, no music, no voice',
  },
  {
    id: 'blastGateOpen',
    file: 'oneshot-blast-gate-open.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.5,
    promptInfluence: 0.6,
    prompt:
      'massive armored subsea rail tunnel blast gate shutter retracting rapidly upward with heavy hydraulic pressure hiss, deep resonant steel track rumble, and solid upper lock thud, industrial sci-fi facility, no music, no voice',
  },
  {
    id: 'blastGateClose',
    file: 'oneshot-blast-gate-close.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.2,
    promptInfluence: 0.6,
    prompt:
      'massive armored subsea rail tunnel blast gate shutter slamming downward onto steel floor with deep heavy hydraulic descent, resonant metallic impact thud, and pressurized seal lock, industrial sci-fi facility, no music, no voice',
  },
  {
    id: 'trainPullout',
    file: 'oneshot-train-pullout.mp3',
    category: 'oneshot',
    loop: false,
    duration: 4.2,
    promptInfluence: 0.6,
    prompt:
      'interior perspective of an electric subsea industrial transit train car accelerating smoothly out of a station dock, rising low electric traction motor hum, heavy steel wheels rolling and clacking faster over rail joints, deep resonant cabin rumble, no music, no voice',
  },
  {
    id: 'trainTunnelCruise',
    file: 'emitter-train-tunnel-cruise.mp3',
    category: 'emitter',
    loop: true,
    duration: 8.0,
    promptInfluence: 0.6,
    prompt:
      'interior perspective of an electric industrial transit train cruising steadily through a deep pressurized underwater steel tunnel, smooth low electric motor drone, rhythmic muted steel rail wheel clack, and soft muffled tunnel air whoosh, seamless constant loop, no music, no voice',
  },
  {
    id: 'trainBrakeStop',
    file: 'oneshot-train-brake-stop.mp3',
    category: 'oneshot',
    loop: false,
    duration: 5.0,
    promptInfluence: 0.6,
    prompt:
      'interior perspective of a heavy electric industrial transit train smoothly decelerating to a complete stop at a station dock, descending traction motor pitch, deep pneumatic air brake hiss, soft metallic brake shoe groan, and final gentle settle, no music, no voice',
  },
  {
    id: 'trainCommsRing',
    file: 'oneshot-train-comms-ring.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.5,
    promptInfluence: 0.7,
    prompt:
      'urgent retro-industrial two-tone electronic incoming radio hail chime ringing twice on a steel bulkhead comms terminal inside a quiet metal train cabin, crisp clear telemetry alert beep with subtle cabin reflection, no music, no voice',
  },
  {
    id: 'trainPowerDown',
    file: 'oneshot-train-power-down.mp3',
    category: 'oneshot',
    loop: false,
    duration: 2.8,
    promptInfluence: 0.7,
    prompt:
      'heavy industrial electric train traction power failure, loud high-voltage circuit breaker clunk tripping off followed by deep electric traction motor pitch winding down and shutting off inside an underwater steel tunnel, ominous power outage drop, no music, no voice',
  },
  {
    id: 'r16HorrorHit',
    file: 'oneshot-r16-horror-hit.mp3',
    category: 'oneshot',
    loop: false,
    duration: 3.2,
    promptInfluence: 0.75,
    prompt:
      'massive cinematic sci-fi horror low-end sub-bass impact hit and dark metallic hull slam reverberating in a cavernous concrete terminal, terrifying dread reveal stinger with deep echoing tail, no voice, no speech',
  },
  {
    id: 'r16MonsterRoar',
    file: 'oneshot-r16-monster-roar.mp3',
    category: 'oneshot',
    loop: false,
    duration: 1.8,
    promptInfluence: 0.75,
    prompt:
      'terrifying close-range deep-sea abyssal horror monster guttural shriek and roaring snarl echoing inside a dark concrete terminal hall, wet organic predator roar layered with sub-bass weight, raw scary creature sound, no music, no human voice',
  },
];

function loadApiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8');
    const match = raw.match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ELEVENLABS_API_KEY not found in environment or .env');
}

function probeAudio(filePath: string): string {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=channels,sample_rate', '-of', 'json', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const info = JSON.parse(out) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ channels?: number; sample_rate?: string }>;
    };
    const st = info.streams?.[0];
    const dur = info.format?.duration ? `${Number(info.format.duration).toFixed(2)}s` : '?s';
    const ch = st?.channels === 2 ? 'stereo' : st?.channels === 1 ? 'mono' : `${st?.channels ?? '?'}ch`;
    const sr = st?.sample_rate ? `${st.sample_rate}Hz` : '?Hz';
    const kb = (statSync(filePath).size / 1024).toFixed(1);
    return `${dur} ${ch} ${sr} ${kb}KB`;
  } catch {
    const kb = (statSync(filePath).size / 1024).toFixed(1);
    return `${kb}KB`;
  }
}

function detectVolume(filePath: string): { mean: number; max: number } | null {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const mean = combined.match(/mean_volume:\s*([-\d.]+)\s*dB/);
  const max = combined.match(/max_volume:\s*([-\d.]+)\s*dB/);
  if (mean?.[1] && max?.[1]) return { mean: Number(mean[1]), max: Number(max[1]) };
  return null;
}

/**
 * Apply pure linear gain via ffmpeg (no dynamic compression, so seamless loop seams stay intact).
 * Beds and emitters target -24 dB mean (capped at -3 dB peak); one-shots target -6 dB peak.
 */
function normalizeLinear(filePath: string, category: AmbienceAssetSpec['category']): string | null {
  const vol = detectVolume(filePath);
  if (!vol) return null;
  let gainDb: number;
  if (category === 'oneshot') {
    gainDb = -6 - vol.max;
  } else {
    const want = -24 - vol.mean;
    const maxAllowed = -3 - vol.max;
    gainDb = Math.min(want, maxAllowed);
  }
  if (Math.abs(gainDb) < 1.5) return `unchanged (mean=${vol.mean.toFixed(1)}dB max=${vol.max.toFixed(1)}dB)`;
  const tmpPath = `${filePath}.norm.mp3`;
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', tmpPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  renameSync(tmpPath, filePath);
  const after = detectVolume(filePath);
  return `gain=${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)}dB -> mean=${after?.mean.toFixed(1) ?? '?'}dB max=${after?.max.toFixed(1) ?? '?'}dB`;
}

async function generateOne(spec: AmbienceAssetSpec, apiKey: string, force: boolean): Promise<'generated' | 'skipped'> {
  const outPath = join(OUT_DIR, spec.file);
  if (existsSync(outPath) && !force) {
    console.log(`[skip] ${spec.id} -> ${spec.file} (${probeAudio(outPath)})`);
    return 'skipped';
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const res = await fetch(`${API_URL}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: spec.prompt,
      model_id: MODEL_ID,
      duration_seconds: spec.duration,
      prompt_influence: spec.promptInfluence,
      loop: spec.loop,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`HTTP ${res.status} generating "${spec.id}": ${detail}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  const norm = normalizeLinear(outPath, spec.category);
  const cost = res.headers.get('character-cost') ?? res.headers.get('x-character-count');
  console.log(`[ok]   ${spec.id} -> ${spec.file} (${probeAudio(outPath)}${norm ? `, ${norm}` : ''}${cost ? `, cost=${cost}` : ''})`);
  return 'generated';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const force = args.includes('--force');
  const all = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const normalizeOnly = args.includes('--normalize');
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) {
      ids.push(args[++i]!);
    }
  }

  if (normalizeOnly) {
    for (const spec of AMBIENCE_MANIFEST) {
      const outPath = join(OUT_DIR, spec.file);
      if (!existsSync(outPath)) continue;
      const msg = normalizeLinear(outPath, spec.category);
      console.log(`[norm] ${spec.id.padEnd(16)} ${spec.file.padEnd(28)} ${msg ?? 'skipped'}`);
    }
    return;
  }

  if (listOnly || (!all && ids.length === 0)) {
    console.log(`Ambience manifest (${AMBIENCE_MANIFEST.length} assets -> public/assets/audio/ambience/):\n`);
    for (const s of AMBIENCE_MANIFEST) {
      const exists = existsSync(join(OUT_DIR, s.file)) ? 'YES' : '---';
      console.log(`  [${exists}] ${s.id.padEnd(16)} ${s.category.padEnd(8)} ${s.loop ? 'loop' : 'shot'} ${String(s.duration).padStart(4)}s  ${s.file}`);
    }
    return;
  }

  const targets = all
    ? [...AMBIENCE_MANIFEST]
    : ids.map((id) => {
        const found = AMBIENCE_MANIFEST.find((s) => s.id === id);
        if (!found) throw new Error(`Unknown asset id "${id}". Run with --list to see available ids.`);
        return found;
      });

  if (dryRun) {
    console.log(`[dry-run] Would generate ${targets.length} asset(s): ${targets.map((t) => t.id).join(', ')}`);
    return;
  }

  const apiKey = loadApiKey();
  let generated = 0;
  let skipped = 0;
  for (const spec of targets) {
    const status = await generateOne(spec, apiKey, force);
    if (status === 'generated') generated++;
    else skipped++;
  }
  console.log(`\nDone: ${generated} generated, ${skipped} skipped.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
