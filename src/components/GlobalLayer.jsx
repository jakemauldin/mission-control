// Mounted once at the root of the logged-in shell, so a ring and an open call survive
// route changes: the ring banner, chime, notification and the docked call.
import RingLayer from "./RingLayer";

export default function GlobalLayer() {
  return <RingLayer />;
}
