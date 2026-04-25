import type { ReactNode } from "react";

type Props = {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
};

export function Scrubber2Layout({ left, center, right }: Props) {
  return (
    <div className="scrubber2-layout">
      {left}
      {center}
      {right}
    </div>
  );
}
