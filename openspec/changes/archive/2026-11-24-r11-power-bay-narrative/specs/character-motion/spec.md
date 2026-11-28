# Spec Delta

## REMOVED Requirements

### Requirement: Giles's injury shows only when he cannot hide it
**Reason**: Giles's infection arc and transformation cliffhanger have been retired as the slice finale moves to the `R16a`/`R16b` Arrival Terminal. Giles remains healthy throughout Slice One.
**Migration**: Keep `giles.infectionStage` at `0` and `giles.bandaged` at `false` across all sequences and debug presets; remove scripted `rub_forearm` and `cough` tells from `intro_shift_change.json`, `action_tunnel.json`, and `action_climax.json`.
