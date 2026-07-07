import { formatVersionLabel } from '../lib/version';

interface AppVersionProps {
  className?: string;
}

/** Small version label shown in the top-right corner of the app shell. */
export function AppVersion({ className = 'app-version' }: AppVersionProps) {
  return (
    <span className={className} title={`Release ${formatVersionLabel()}`}>
      {formatVersionLabel()}
    </span>
  );
}
