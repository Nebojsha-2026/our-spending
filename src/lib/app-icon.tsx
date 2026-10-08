import { ImageResponse } from "next/og";

/**
 * App icon: three rising bars on teal, echoing the Overview trend chart.
 * The glyph sits inside the maskable safe zone, so one square image serves
 * both "any" and "maskable"; `rounded` is only for the browser-tab favicon.
 */
export function appIcon(size: number, { rounded = false } = {}) {
  const bar = (h: number, opacity: number) => (
    <div
      style={{
        width: size * 0.13,
        height: size * h,
        borderRadius: `${size * 0.035}px ${size * 0.035}px ${size * 0.012}px ${size * 0.012}px`,
        background: "#FFFFFF",
        opacity,
      }}
    />
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: size * 0.06,
          paddingBottom: size * 0.27,
          background: "#0F766E",
          borderRadius: rounded ? size * 0.22 : 0,
        }}
      >
        {bar(0.2, 0.6)}
        {bar(0.31, 0.8)}
        {bar(0.44, 1)}
      </div>
    ),
    { width: size, height: size },
  );
}
