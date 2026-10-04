// Peer-to-peer networking via Trystero (WebRTC) using public Nostr relays for signalling.
// No game server: relays only help the two browsers find each other, then data flows P2P.
import { joinRoom, selfId } from 'trystero/nostr';

const APP_ID = 'orb-smash-duel-tr-v1';
const ACTIONS = ['pose', 'state', 'spawn', 'kill', 'hit', 'ready'];
// Well-known public Nostr relays (only used for the WebRTC handshake). Both players must use the same list.
const RELAYS = [
  'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://bucket.coracle.social',
  'wss://nostr.data.haus', 'wss://nostr-relay.corb.net', 'wss://nostr.sathoarder.com',
];
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export { selfId };

export class Net {
  constructor() {
    this.room = null;
    this.code = null;
    this.handlers = {};
    this.peers = new Set();
    this.acts = {};
  }
  on(type, fn) { this.handlers[type] = fn; }
  emit(type, ...a) { const h = this.handlers[type]; if (h) h(...a); }

  // extraIce: optional extra ICE servers, e.g. a TURN server for tricky networks (?turn=turn:host:port&tu=user&tp=pass)
  join(code, extraIce = []) {
    this.leave();
    this.code = code;
    let room;
    try {
      room = joinRoom({ appId: APP_ID, relayConfig: { urls: RELAYS }, rtcConfig: { iceServers: [...ICE, ...extraIce] } }, code, {
        onJoinError: (e) => this.emit('error', e && e.error ? e.error : String(e)),
      });
    } catch (e) {
      this.emit('error', String(e && e.message ? e.message : e));
      return;
    }
    this.room = room;
    room.onPeerJoin = (id) => { if (this.room !== room) return; this.peers.add(id); this.emit('peerjoin', id); };
    room.onPeerLeave = (id) => { if (this.room !== room) return; this.peers.delete(id); this.emit('peerleave', id); };
    for (const name of ACTIONS) {
      const a = room.makeAction(name);
      if (Array.isArray(a)) {
        // older Trystero API: [send, receive]
        this.acts[name] = (d, t) => a[0](d, t);
        a[1]((d, id) => { if (this.room === room) this.emit('msg', name, d, id); });
      } else {
        this.acts[name] = (d, t) => a.send(d, t ? { target: t } : undefined);
        a.onMessage = (d, ctx) => { if (this.room === room) this.emit('msg', name, d, ctx && ctx.peerId); };
      }
    }
    this.emit('joined', code);
  }

  send(name, data, target) {
    if (!this.room) return;
    try {
      const p = this.acts[name] && this.acts[name](data, target);
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* peer may have gone */ }
  }

  leave() {
    if (!this.room) return;
    const r = this.room;
    this.room = null;
    this.code = null;
    this.peers.clear();
    try { r.leave(); } catch (e) { /* ignore */ }
  }

  async ping(id) {
    try { return this.room ? await this.room.ping(id) : null; } catch (e) { return null; }
  }
}
