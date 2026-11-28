# Tasks

## 1. Hide markers properly

- [x] 1.1 Add a failing test next to `src/ui/hud/worldMarkerHud.ts` for the three scenarios in the `hud-wayfinding` delta (completion with another marker still shown, target behind the camera, marker returning with a fresh distance); verify it fails today
- [x] 1.2 Add `.world-marker[hidden] { display: none; }` to `src/ui/styles/hud.css`; verify the 1.1 test passes
- [x] 1.3 Sweep `src/ui/styles/*.css` for any class that sets `display` and is toggled with `hidden` in `src/ui/`, and give each a `[hidden]` rule or list it as already safe in the commit message; verify with the 1.1 fallback check if no DOM is available
- [x] 1.4 Check in the browser at `?slot=scratch`: take the Level 2 card in the Director's office and confirm the marker is gone and stays gone; reuse a running dev server and close the tab after
