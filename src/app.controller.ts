import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './cross/decorators/public.decorator';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Service banner',
    description:
      'Root route. Answers a fixed string, reads nothing and checks nothing — use ' +
      '`/health/live` and `/health/ready` for liveness and readiness.',
  })
  @ApiOkResponse({ description: 'Static banner text.', type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}
