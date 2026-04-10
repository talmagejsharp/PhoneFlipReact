type PermissionCardProps = {
  denied?: boolean;
  onRequestPermission: () => void;
};

export function PermissionCard({
  denied = false,
  onRequestPermission,
}: PermissionCardProps) {
  return (
    <div className="card">
      <div className="eyebrow">PhoneFlip</div>
      <h1>{denied ? "Sensor access got blocked" : "Ready to flip?"}</h1>
      <p className="subcopy">
        {denied
          ? "No stress. Tap below and try sensor permission again."
          : "This needs motion and orientation access so it can watch your trick."}
      </p>

      <button className="primary-button" onClick={onRequestPermission}>
        {denied ? "Try Again" : "Enable Motion"}
      </button>

      <p className="tiny-copy">
        On iPhone, sensor access must be requested from a tap.
      </p>
    </div>
  );
}