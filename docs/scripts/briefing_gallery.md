# Briefing script: `briefing_gallery`

Generated from `src/data/sequences/briefing_gallery.json` and the `brief_*` lines in
`src/data/dialogue/slice01.json`. Edit those, not this. Times are rough. See ADR-0023 and `morning-briefing` spec.

*Observation gallery (R03), free-roam (no letterbox bars or movement lock). Triggers a few steps into the room. Security chief Katie Heins (short purple hair) stands at the front; Sung is in the room; Giles and Okafor walk briskly in while Heins opens. Behind everyone, the Lab B glass, blinds down.*

`0:00` **HEINS**: Morning, all. Grab a wall, this'll be quick.  
`0:03` **HEINS**: Hit the lock on that door behind you — keep the hall noise out.  

*Once everyone is inside R03, `D_R02_R03` closes and locks behind the team.*

`0:06` **HEINS**: Halcyon came in on time, for once. Divers, your sample run's cleared for oh-nine-hundred.  
`0:10` **SUNG** (relieved): Finally.  
`0:12` **HEINS**: Doctor, med checks for everyone off the sub. Giles...  
`0:15` **GILES** (question): Let me guess. Ring three pump.  
`0:17` **HEINS**: Ring three pump.  
`0:19` **GILES** (laugh): She loves me.  
`0:21` **HEINS**: Jay, morning rounds. Hydroponics, the dive bay, and Admin has your new card. *(Objectives populate live: Hydroponics, Dive bay, TAG admin.)*  
`0:26` **JAY** (question): Level 2? You're finally trusting me with the good doors?  
`0:28` **HEINS** (laugh): Don't make me regret it.  

*The big screen chimes on: Director Hale, polished, smiling, TAG logo behind him.*

`0:30` **DIRECTOR HALE (on screen)**: Good morning, Thalassa. A brief note before you start your day.  
`0:33` **DIRECTOR HALE (on screen)**: As a precaution, Lab B is under a routine quarantine until further notice.  
`0:37` **DIRECTOR HALE (on screen)**: Please keep clear of the east corridor. There is no cause for concern.  
`0:41` **DIRECTOR HALE (on screen)**: Thank you. TAG Industries appreciates you.  

*The screen cuts back to the TAG logo.*

`0:44` **HEINS** (whisper): ...Nobody told me that.  

*Okafor glances aside. He says nothing.*

`0:47` **GILES** (laugh): Well. I feel reassured.  
`0:49` **HEINS**: All right. You heard the man. Go on, get to work.  

*`D_R02_R03` unlocks. `briefingSeen` set. Autosave `cp_briefing`. (~0:52)*
