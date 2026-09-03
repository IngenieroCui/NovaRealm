import { Body, Controller, Post } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantActionRequestDto, AssistantStartRequestDto, ChatRequestDto, CompareRequestDto } from './assistant.dto';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('start')
  start(@Body() input: AssistantStartRequestDto) {
    return this.assistant.start(input);
  }

  @Post('chat')
  chat(@Body() input: ChatRequestDto) {
    return this.assistant.chat(input);
  }

  @Post('action')
  action(@Body() input: AssistantActionRequestDto) {
    return this.assistant.action(input);
  }

  @Post('compare')
  compare(@Body() input: CompareRequestDto) {
    return this.assistant.compare(input);
  }
}
