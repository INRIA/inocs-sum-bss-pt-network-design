import { BikeGlyph } from '../../glyphs';
import { useMapView } from '../MapContext';

/** The bike glyph spans ~10.2 user units; under 6 rendered px its wheels stop reading as a bike. */
const GLYPH_UNITS = 10.2;

interface Props {
  dots: [number, number][];
  color: string;
  opacity: number;
}

/**
 * The 139 existing (real, unbuilt-by-the-model) bike stations — one grey, unhaloed glyph each
 * (CityMap layer 6, v2 section 4.1). Below a rendered size threshold they degrade to plain dots,
 * read from the shared `MapView` context instead of being passed unitPx directly.
 */
export default function ExistingBikesLayer({ dots, color, opacity }: Props) {
  const { unitPx } = useMapView();
  const microDot = GLYPH_UNITS * 0.5 * unitPx < 6;
  return (
    <g opacity={opacity}>
      {dots.map(([x, y], i) => (
        <BikeGlyph key={i} x={x} y={y} s={0.5} color={color} dot={microDot} />
      ))}
    </g>
  );
}
