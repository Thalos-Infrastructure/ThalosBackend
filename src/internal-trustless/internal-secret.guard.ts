import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.THALOS_INTERNAL_SECRET;
    if (!expected) {
      throw new UnauthorizedException("THALOS_INTERNAL_SECRET not configured");
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers["x-thalos-internal-secret"];
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== expected) {
      throw new UnauthorizedException("Invalid internal secret");
    }
    return true;
  }
}
