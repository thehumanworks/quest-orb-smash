# Orb Smash: Duel

A WebXR mixed-reality game for Meta Quest 3. Smash neon orbs with glowing sabres (or bare hands) in passthrough, solo or 1v1 between two headsets. No install: open the URL in the Meta Quest Browser.

## Play
1. Open the URL in the Quest Browser and tap **Enter Mixed Reality** (or **Enter VR** for a starfield arena).
2. Smash orbs with your sabres (controllers) or fingertips and palms (hand tracking). Gold orbs = +50, red spiky bombs = −40 and break your combo. Chain hits for up to a ×8 multiplier.
3. Pull the trigger (or pinch) to ready up. Rounds last 50 seconds. Versus is best of 3, and both players pull the trigger for a rematch.

### Two players
- Both headsets open the same URL. Both join room **ORB1** automatically. For a private game, tap **New code** on one headset and type that code into the other (or open `…/?room=CODE`).
- The page shows "Rival connected" and which side you are on (LEFT is cyan, RIGHT is pink). Then both tap Enter Mixed Reality.
- Same room: stand side by side about 1.4 m apart, facing the same way, on your assigned side, then enter. Different rooms: just play, because your rival is drawn next to you as a glowing avatar.
- Networking is peer-to-peer WebRTC (Trystero). Public Nostr relays are only used for the handshake. There is no game server. Host-authoritative: one headset spawns the orbs and settles who hit first.

### Desktop
Open the URL on a laptop. Click orbs to smash and press Space to ready up. Two browser tabs (or a laptop plus a headset) with the same room code play against each other.

## Develop
```bash
npm install
npm run dev      # https needed for WebXR on a headset: use the deployed URL or a tunnel
npm run build    # outputs dist/
```
Code: `src/main.js` (game, XR, input, host logic), `src/net.js` (P2P), `src/audio.js` (Web Audio synth), `src/fx.js` (particles, rings, popups, flash), `src/panel.js` (in-world scoreboard).

Optional: `?turn=turn:host:port&tu=user&tp=pass` adds a TURN server for networks where direct P2P fails. `?solo` starts offline.
