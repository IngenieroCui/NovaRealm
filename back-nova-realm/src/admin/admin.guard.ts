import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = process.env.ADMIN_API_KEY?.trim();
    const provided = request.header('x-admin-key');
    if (!expected) {
      throw new UnauthorizedException(
        'La administración no está configurada. Define ADMIN_API_KEY en el backend.',
      );
    }
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Clave de administración inválida');
    }
    return true;
  }
}
