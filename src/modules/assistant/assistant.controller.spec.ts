import { AssistantController } from './assistant.controller';
import { AssistantChatRequestDto } from './dto/assistant-chat.dto';

describe('AssistantController', () => {
  const dto: AssistantChatRequestDto = {
    messages: [{ role: 'user', content: 'How do I add a zone?' }],
  };
  let assistantService: { chat: jest.Mock };
  let controller: AssistantController;

  beforeEach(() => {
    assistantService = { chat: jest.fn() };
    controller = new AssistantController(assistantService as never);
  });

  it('delegates the conversation to the service', async () => {
    await controller.chat(dto);

    expect(assistantService.chat).toHaveBeenCalledWith(dto);
  });
});
