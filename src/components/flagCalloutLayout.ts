import type { PurchaseFlag } from '../types';

export interface FlagCalloutLayoutInput {
  flags: Array<PurchaseFlag & { color: string }>;
  leftBound: number;
  rightBound: number;
  topY: number;
  bottomBound: number;
  getAnchorX: (age: number) => number;
  getAnchorY: (age: number) => number;
}

export interface FlagCalloutLayout {
  id: string;
  lane: number;
  label: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  stemTopY: number;
  stemBottomY: number;
}

const FLAG_HEIGHT = 22;
const FLAG_Y_PADDING = 4;
const LANE_GAP = 6;
const LANE_CLEARANCE = 6;
const STEM_MIN_LENGTH = 18;

const getFlagLabelWidth = (label: string) => Math.max(60, label.length * 8 + 16);

export const layoutFlagCallouts = ({
  flags,
  leftBound,
  rightBound,
  topY,
  bottomBound,
  getAnchorX,
  getAnchorY
}: FlagCalloutLayoutInput): FlagCalloutLayout[] => {
  const laneRightEdges: number[] = [];

  const sorted = [...flags]
    .map((flag) => {
      const width = getFlagLabelWidth(flag.label);
      const anchorX = getAnchorX(flag.age);
      const x = Math.max(leftBound, Math.min(anchorX, rightBound - width));
      return { flag, width, anchorX, x };
    })
    .sort((a, b) => a.anchorX - b.anchorX);

  return sorted.map(({ flag, width, anchorX, x }) => {
    let lane = laneRightEdges.findIndex((rightEdge) => x >= rightEdge + LANE_CLEARANCE);
    if (lane < 0) {
      lane = laneRightEdges.length;
      laneRightEdges.push(x + width);
    } else {
      laneRightEdges[lane] = x + width;
    }

    const y = topY + FLAG_Y_PADDING + lane * (FLAG_HEIGHT + LANE_GAP);
    const stemTopY = y + FLAG_HEIGHT;
    const anchorY = getAnchorY(flag.age);
    const stemBottomY = Math.max(stemTopY + STEM_MIN_LENGTH, anchorY - 6);
    const label = flag.label.length > 14 ? `${flag.label.slice(0, 13)}...` : flag.label;

    return {
      id: flag.id,
      lane,
      label,
      color: flag.color,
      x,
      y,
      width,
      height: FLAG_HEIGHT,
      anchorX,
      stemTopY,
      stemBottomY: Math.min(stemBottomY, bottomBound)
    };
  });
};
