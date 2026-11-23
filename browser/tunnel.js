// The Browser's encrypted tunnel: epoxy-transport (./epoxy/) with one fix.
// bare-mux starts the tunnel the first time something is fetched through it. If several pages, pictures or video
// pieces were asked for at the same moment (a tab reopening, a reload in the middle of a video, a switch to another
// server), epoxy was started several times at once, and that froze it: nothing loaded until the page was closed.
// Here every early request waits for the same single start-up.
import EpoxyTransport from './epoxy/index.js';

export default class Tunnel extends EpoxyTransport {
  init() {
    if (!this.starting) this.starting = super.init().catch(err => { this.starting = null; throw err; });
    return this.starting;
  }
}
