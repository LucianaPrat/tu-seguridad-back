import { ErrorCode } from '../../cross/common/constants';
import { AssistantController } from './assistant.controller';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';

const clip = {
  buffer: Buffer.from('opus-bytes'),
  originalname: 'question.webm',
  mimetype: 'audio/webm',
} as Express.Multer.File;

describe('AssistantController', () => {
  const dto: AssistantChatRequestDto = {
    messages: [{ role: 'user', content: 'How do I add a zone?' }],
  };
  let assistantService: {
    chat: jest.Mock;
    transcribe: jest.Mock;
    speak: jest.Mock;
  };
  let controller: AssistantController;
  let res: { setHeader: jest.Mock; end: jest.Mock };

  beforeEach(() => {
    assistantService = {
      chat: jest.fn(),
      transcribe: jest.fn(),
      speak: jest.fn(),
    };
    res = { setHeader: jest.fn(), end: jest.fn() };
    controller = new AssistantController(assistantService as never);
  });

  it('delegates the conversation to the service', async () => {
    await controller.chat(dto);

    expect(assistantService.chat).toHaveBeenCalledWith(dto);
  });

  it('delegates the uploaded clip to the service', async () => {
    await controller.transcribe(clip);

    expect(assistantService.transcribe).toHaveBeenCalledWith(clip);
  });

  // `speak` is the one handler here that writes the response itself, so what it
  // writes is worth asserting: the interceptor never sees these bytes.
  it('answers the audio bytes with an mpeg content type and length', async () => {
    const mp3 = Buffer.from('ID3-bytes');
    assistantService.speak.mockResolvedValue({ ok: true, data: mp3 });

    await controller.speak({ text: 'Desde la cámara.' }, res as never);

    expect(assistantService.speak).toHaveBeenCalledWith('Desde la cámara.');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Length',
      mp3.byteLength,
    );
    expect(res.end).toHaveBeenCalledWith(mp3);
  });

  it('throws the mapped status when the service refuses, writing nothing', async () => {
    assistantService.speak.mockResolvedValue({
      ok: false,
      code: ErrorCode.CONFLICT,
      message: 'voice is off',
    });

    await expect(
      controller.speak({ text: 'hola' }, res as never),
    ).rejects.toMatchObject({ status: 409 });
    expect(res.end).not.toHaveBeenCalled();
  });
});
