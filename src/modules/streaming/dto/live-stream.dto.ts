import { ApiProperty } from '@nestjs/swagger';

export class LiveStreamDto {
  @ApiProperty({
    enum: ['hls'],
    description:
      'How to play `url`. Present from the first version so a second transport ' +
      'is a new value here rather than a second endpoint.',
  })
  protocol!: 'hls';

  @ApiProperty({
    example: 'http://127.0.0.1:8888/6f1c.../index.m3u8',
    description:
      'The HLS playlist, served by the media server and not by this API. Every ' +
      'request for it and for each segment must carry the caller bearer token — ' +
      'the media server asks this API to authorize each one, so nothing about ' +
      'the URL itself grants access.',
  })
  url!: string;
}
