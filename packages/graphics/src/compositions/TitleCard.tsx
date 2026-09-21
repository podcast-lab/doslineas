import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TitleCardProps } from "../props.js";
import { fontFaceCss, fontStack, readableOn, withAlpha } from "../theme.js";

export const TitleCard: React.FC<TitleCardProps> = ({
  kind,
  headline,
  tagline,
  colors,
  heading,
  body,
  logoDataUrl
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const entrance = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  const exit = interpolate(frame, [durationInFrames - fps * 0.5, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateRight: "clamp" });

  const margin = width * 0.09;
  const text = readableOn(colors.background, [colors.text, colors.primary, colors.accent]);
  const alignment = kind === "intro" ? "flex-start" : "center";

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background, opacity: exit }}>
      <style>{fontFaceCss([heading, body])}</style>

      <AbsoluteFill
        style={{
          background: `linear-gradient(115deg, ${withAlpha(colors.primary, 0.85)} 0%, ${withAlpha(colors.accent, 0.55)} 55%, ${withAlpha(colors.background, 0)} 100%)`,
          transform: `translateX(${interpolate(entrance, [0, 1], [-width * 0.35, 0])}px)`,
          opacity: interpolate(entrance, [0, 1], [0, 1])
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: alignment,
          padding: margin,
          gap: height * 0.03,
          textAlign: kind === "intro" ? "left" : "center"
        }}
      >
        {logoDataUrl === null ? null : (
          <img
            src={logoDataUrl}
            alt=""
            style={{ height: height * 0.09, objectFit: "contain", marginBottom: height * 0.02 }}
          />
        )}

        <div
          style={{
            fontFamily: fontStack(heading),
            fontWeight: heading.weight,
            fontSize: height * 0.095,
            lineHeight: 1.05,
            letterSpacing: -height * 0.0015,
            color: text,
            transform: `translateY(${interpolate(entrance, [0, 1], [height * 0.06, 0])}px)`
          }}
        >
          {headline}
        </div>

        {tagline === "" ? null : (
          <div
            style={{
              fontFamily: fontStack(body),
              fontWeight: body.weight,
              fontSize: height * 0.038,
              color: colors.muted,
              opacity: interpolate(entrance, [0.35, 1], [0, 1], { extrapolateLeft: "clamp" })
            }}
          >
            {tagline}
          </div>
        )}
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: Math.max(4, height * 0.008),
          width: `${progress * 100}%`,
          backgroundColor: colors.accent
        }}
      />
    </AbsoluteFill>
  );
};
