import { Body, Controller, Post } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { ChatRequestDto, CompareRequestDto } from './assistant.dto';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  chat(@Body() input: ChatRequestDto) {
    return this.assistant.chat(input);
  }

  @Post('compare')
  compare(@Body() input: CompareRequestDto) {
    return this.assistant.compare(input);
  }
}
