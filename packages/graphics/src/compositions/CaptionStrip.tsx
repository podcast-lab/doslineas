import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStripProps } from "../props.js";
import { fontFaceCss, fontStack, readableOn, withAlpha } from "../theme.js";

export const CaptionStrip: React.FC<CaptionStripProps> = ({
  title,
  withTitle,
  withSpeakers,
  position,
  safeAreaPercent,
  lines,
  colors,
  heading,
  body
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const seconds = frame / fps;

  const margin = (width * safeAreaPercent) / 100;
  const text = readableOn(colors.background, [colors.text, colors.primary]);
  const active = lines.find((line) => seconds >= line.startSeconds && seconds < line.endSeconds) ?? null;

  const titleReveal = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });

  return (
    <AbsoluteFill>
      <style>{fontFaceCss([heading, body])}</style>

      {withTitle && title !== "" ? (
        <div
          style={{
            position: "absolute",
            top: (height * safeAreaPercent) / 100,
            left: margin,
            right: margin,
            display: "flex",
            flexDirection: "column",
            gap: height * 0.008,
            alignItems: "center",
            opacity: interpolate(titleReveal, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(titleReveal, [0, 1], [-height * 0.03, 0])}px)`
          }}
        >
          <div
            style={{
              fontFamily: fontStack(heading),
              fontWeight: heading.weight,
              fontSize: height * 0.026,
              lineHeight: 1.15,
              textAlign: "center",
              color: text,
              backgroundColor: withAlpha(colors.background, 0.78),
              padding: `${height * 0.012}px ${width * 0.03}px`,
              borderRadius: height * 0.008
            }}
          >
            {title}
          </div>
          <div style={{ width: width * 0.12, height: Math.max(4, height * 0.003), backgroundColor: colors.accent }} />
        </div>
      ) : null}

      {active === null ? null : (
        <CaptionBlock
          key={active.startSeconds}
          line={active}
          seconds={seconds}
          fps={fps}
          frame={frame}
          width={width}
          height={height}
          margin={margin}
          position={position}
          safeAreaPercent={safeAreaPercent}
          withSpeakers={withSpeakers}
          colors={colors}
          heading={heading}
          body={body}
          text={text}
        />
      )}
    </AbsoluteFill>
  );
};

interface CaptionBlockProps {
  readonly line: CaptionStripProps["lines"][number];
  readonly seconds: number;
  readonly fps: number;
  readonly frame: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly position: CaptionStripProps["position"];
  readonly safeAreaPercent: number;
  readonly withSpeakers: boolean;
  readonly colors: CaptionStripProps["colors"];
  readonly heading: CaptionStripProps["heading"];
  readonly body: CaptionStripProps["body"];
  readonly text: string;
}

const CaptionBlock: React.FC<CaptionBlockProps> = ({
  line,
  seconds,
  fps,
  frame,
  width,
  height,
  margin,
  position,
  safeAreaPercent,
  withSpeakers,
  colors,
  heading,
  body,
  text
}) => {
  const entrance = spring({
    frame: frame - Math.round(line.startSeconds * fps),
    fps,
    config: { damping: 200, mass: 0.4 }
  });

  const anchor =
    position === "bottom"
      ? { bottom: (height * safeAreaPercent) / 100 }
      : { top: height / 2, transform: "translateY(-50%)" };

  return (
    <div
      style={{
        position: "absolute",
        left: margin,
        right: margin,
        ...anchor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: height * 0.01,
        opacity: interpolate(entrance, [0, 0.4], [0, 1], { extrapolateRight: "clamp" })
      }}
    >
      {withSpeakers && line.speaker !== "" ? (
        <div
          style={{
            fontFamily: fontStack(body),
            fontWeight: body.weight,
            fontSize: height * 0.018,
            letterSpacing: height * 0.002,
            textTransform: "uppercase",
            color: colors.accent
          }}
        >
          {line.speaker}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `${height * 0.006}px ${width * 0.016}px`,
          backgroundColor: withAlpha(colors.background, 0.72),
          padding: `${height * 0.018}px ${width * 0.035}px`,
          borderRadius: height * 0.01,
          transform: `translateY(${interpolate(entrance, [0, 1], [height * 0.02, 0])}px)`
        }}
      >
        {line.words.map((word, index) => {
          const spoken = seconds >= word.startSeconds && seconds < word.endSeconds;
          return (
            <span
              key={`${word.text}-${index}`}
              style={{
                fontFamily: fontStack(heading),
                fontWeight: heading.weight,
                fontSize: height * 0.036,
                lineHeight: 1.15,
                color: spoken ? colors.accent : text,
                transform: spoken ? "scale(1.06)" : "scale(1)",
                transformOrigin: "center bottom",
                display: "inline-block"
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
