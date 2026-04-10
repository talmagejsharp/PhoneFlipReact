export function UnsupportedCard() {
  return (
    <div className="card">
      <div className="eyebrow">PhoneFlip</div>
      <h1>Not supported here</h1>
      <p className="subcopy">
        This app needs a mobile device with motion sensors. Open it on your iPhone
        or another supported phone and give it a flick.
      </p>
      <div className="pill-row">
        <span className="pill">mobile only</span>
        <span className="pill">motion sensors required</span>
      </div>
    </div>
  );
}