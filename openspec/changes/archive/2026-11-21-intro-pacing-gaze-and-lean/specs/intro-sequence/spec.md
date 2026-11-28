# Spec Delta

## MODIFIED Requirements

### Requirement: Bram serves the squad
Bram SHALL already be making coffee when Giles and Okafor come in. They SHALL walk round him and settle back against the counter, turned toward each other. Bram SHALL hand Okafor a mug beside him, then take a tight route round to Giles's far side, so Jay sees the hand-off side-on, before going back to his station. Bram's pour, walk to Giles, and mug hand-offs SHALL overlap with the surrounding kitchen banter so dialogue does not stall in silence while he walks.

#### Scenario: Coffee for the squad
- **WHEN** the squad are at the counter and Bram's greeting is done
- **THEN** Bram hands Okafor a mug, then moves cleanly around to Giles's far side while Okafor and Giles exchange lines, handing Giles his mug side-on so both hold their mugs leaning back against the counter

#### Scenario: No long silent stall before Giles receives coffee
- **WHEN** Okafor thanks Bram for his mug
- **THEN** Bram is already moving around to Giles's far side and delivers Giles's mug without an extended silent detour or an abrupt torso lean

## ADDED Requirements

### Requirement: Paced intro beats with addressee-accurate gaze
The intro SHALL keep all existing voiced lines while avoiding multi-second dead-air stalls between docking, checkpoint, walk, and kitchen beats. In multi-person intro exchanges (dock checkpoint, corridor walk, and kitchen banter), each speaking NPC SHALL look toward the person they are addressing in the script rather than staring at whoever happened to speak last on a different thread.

#### Scenario: Sung greets Jay after Ruiz's guard scan
- **WHEN** Sung steps up to the counter and greets Jay (`intro_sung_01`) right after the dock guard clears Ruiz
- **THEN** Sung looks toward Jay rather than toward the dock guard

#### Scenario: Kitchen banter crosses between three or more speakers
- **WHEN** Giles remarks to Okafor about Priya (`intro_giles_10`), Priya offers coffee to Jay (`intro_priya_05`), or Okafor and Giles wrap up with Jay (`intro_okafor_09`, `intro_giles_14`)
- **THEN** each speaker looks at their intended addressee (Okafor or Jay) rather than at the previous speaker

#### Scenario: Skipped intro keeps exact end state
- **WHEN** the intro is skipped at any point after the pacing and gaze updates
- **THEN** the end state (positions, flags, checkpoint, played lines, and mug in Jay's hand) matches watching to the end
