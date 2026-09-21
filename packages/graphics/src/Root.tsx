import React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { Composition } from "remotion";
import { CaptionStrip } from "./compositions/CaptionStrip.js";
import { LowerThird } from "./compositions/LowerThird.js";
import { TitleCard } from "./compositions/TitleCard.js";
import type { CaptionStripProps, LowerThirdProps, TitleCardProps } from "./props.js";
import {
  DEFAULT_CAPTION_STRIP,
  DEFAULT_LOWER_THIRD,
  DEFAULT_TITLE_CARD,
  captionStripSchema,
  lowerThirdSchema,
  titleCardSchema
} from "./props.js";

interface Frame {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
}

function frameMetadata<T extends Frame & Record<string, unknown>>(): CalculateMetadataFunction<T> {
  return ({ props }) => ({
    width: props.width,
    height: props.height,
    fps: props.fps,
    durationInFrames: props.durationInFrames
  });
}

const OUTRO_PROPS: TitleCardProps = {
  ...DEFAULT_TITLE_CARD,
  kind: "outro",
  headline: "Gracias por escuchar",
  tagline: "Nuevo episodio cada semana"
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Intro"
      component={TitleCard}
      schema={titleCardSchema}
      defaultProps={DEFAULT_TITLE_CARD}
      calculateMetadata={frameMetadata<TitleCardProps>()}
      width={DEFAULT_TITLE_CARD.width}
      height={DEFAULT_TITLE_CARD.height}
      fps={DEFAULT_TITLE_CARD.fps}
      durationInFrames={DEFAULT_TITLE_CARD.durationInFrames}
    />
    <Composition
      id="Outro"
      component={TitleCard}
      schema={titleCardSchema}
      defaultProps={OUTRO_PROPS}
      calculateMetadata={frameMetadata<TitleCardProps>()}
      width={OUTRO_PROPS.width}
      height={OUTRO_PROPS.height}
      fps={OUTRO_PROPS.fps}
      durationInFrames={OUTRO_PROPS.durationInFrames}
    />
    <Composition
      id="LowerThird"
      component={LowerThird}
      schema={lowerThirdSchema}
      defaultProps={DEFAULT_LOWER_THIRD}
      calculateMetadata={frameMetadata<LowerThirdProps>()}
      width={DEFAULT_LOWER_THIRD.width}
      height={DEFAULT_LOWER_THIRD.height}
      fps={DEFAULT_LOWER_THIRD.fps}
      durationInFrames={DEFAULT_LOWER_THIRD.durationInFrames}
    />
    <Composition
      id="CaptionStrip"
      component={CaptionStrip}
      schema={captionStripSchema}
      defaultProps={DEFAULT_CAPTION_STRIP}
      calculateMetadata={frameMetadata<CaptionStripProps>()}
      width={DEFAULT_CAPTION_STRIP.width}
      height={DEFAULT_CAPTION_STRIP.height}
      fps={DEFAULT_CAPTION_STRIP.fps}
      durationInFrames={DEFAULT_CAPTION_STRIP.durationInFrames}
    />
  </>
);
