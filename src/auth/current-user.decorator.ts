import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type AuthUserCtx = { userId: string; email?: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserCtx => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUserCtx;
  },
);
