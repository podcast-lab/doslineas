import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { LowerThirdProps } from "../props.js";
import { fontFaceCss, fontStack, readableOn, withAlpha } from "../theme.js";

export const LowerThird: React.FC<LowerThirdProps> = ({
  name,
  title,
  corner,
  marginPercent,
  colors,
  heading,
  body
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 200, mass: 0.5 } });
  const exit = spring({
    frame: frame - (durationInFrames - fps * 0.6),
    fps,
    config: { damping: 200, mass: 0.5 }
  });
  const reveal = Math.max(0, entrance - exit);

  const fromLeft = corner === "bottom-left";
  const margin = (width * marginPercent) / 100;
  const text = readableOn(colors.background, [colors.text, colors.primary]);
  const slide = interpolate(reveal, [0, 1], [fromLeft ? -width * 0.12 : width * 0.12, 0]);

  return (
    <AbsoluteFill>
      <style>{fontFaceCss([heading, body])}</style>

      <div
        style={{
          position: "absolute",
          bottom: (height * marginPercent) / 100,
          left: fromLeft ? margin : undefined,
          right: fromLeft ? undefined : margin,
          display: "flex",
          alignItems: "stretch",
          transform: `translateX(${slide}px)`,
          opacity: interpolate(reveal, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
          clipPath: `inset(0 ${fromLeft ? `${(1 - reveal) * 100}% 0 0` : `0 0 ${(1 - reveal) * 100}%`})`,
          flexDirection: fromLeft ? "row" : "row-reverse"
        }}
      >
        <div style={{ width: Math.max(6, width * 0.005), backgroundColor: colors.accent }} />
        <div
          style={{
            backgroundColor: withAlpha(colors.background, 0.85),
            padding: `${height * 0.024}px ${width * 0.022}px`,
            display: "flex",
            flexDirection: "column",
            gap: height * 0.008,
            alignItems: fromLeft ? "flex-start" : "flex-end"
          }}
        >
          <div
            style={{
              fontFamily: fontStack(heading),
              fontWeight: heading.weight,
              fontSize: height * 0.045,
              lineHeight: 1.1,
              color: text
            }}
          >
            {name}
          </div>
          {title === "" ? null : (
            <div
              style={{
                fontFamily: fontStack(body),
                fontWeight: body.weight,
                fontSize: height * 0.024,
                letterSpacing: height * 0.0025,
                textTransform: "uppercase",
                color: colors.muted
              }}
            >
              {title}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
