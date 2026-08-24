import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUserCtx } from '../auth/current-user.decorator';
import { GitHubEvidenceService } from './github-evidence.service';
import { MergedPrsQueryDto } from './dto/merged-prs-query.dto';
import { AttachPrDto } from './dto/attach-pr.dto';

@ApiTags('github-evidence')
@Controller('github-evidence')
export class GitHubEvidenceController {
  constructor(
    private readonly github: GitHubEvidenceService,
    private readonly config: ConfigService,
  ) {}

  // ── OAuth flow ──────────────────────────────────────────────────────────

  @Get('oauth/url')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Generate GitHub OAuth authorization URL' })
  getOAuthUrl(@CurrentUser() user: AuthUserCtx) {
    return this.github.getOAuthUrl(user.userId);
  }

  @Get('oauth/callback')
  @ApiOperation({
    summary: 'GitHub OAuth callback — exchanges code for verified identity',
    description:
      'Called by GitHub after the user authorizes. Validates HMAC-signed state, ' +
      'exchanges the code for a token, reads the GitHub username, writes it to the ' +
      'profile, and discards the token. Redirects to the frontend on completion.',
  })
  @ApiQuery({ name: 'code', description: 'Authorization code from GitHub' })
  @ApiQuery({ name: 'state', description: 'HMAC-signed state parameter' })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.github.handleOAuthCallback(code, state);
    const frontendUrl = this.config.get<string>('THALOS_APP_PUBLIC_URL', 'http://localhost:3000');
    const params = new URLSearchParams({
      github_linked: 'true',
      github_username: result.github_username,
    });
    res.redirect(`${frontendUrl}/settings?${params.toString()}`);
  }

  @Delete('link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Remove GitHub link from profile' })
  unlinkGitHub(@CurrentUser() user: AuthUserCtx) {
    return this.github.unlinkGitHub(user.userId);
  }

  // ── Merged PR search ────────────────────────────────────────────────────

  @Get('merged-prs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List merged PRs scoped to a repository',
    description:
      'Uses GitHub Search API with repo-scoped query: ' +
      'repo:{owner}/{repo} author:{github_username} is:pr is:merged. ' +
      'Requires a verified GitHub link on the profile. Token is never exposed.',
  })
  @ApiQuery({
    name: 'repo',
    description: 'GitHub repository in owner/repo format',
    example: 'stellar/stellar-core',
  })
  getMergedPRs(@CurrentUser() user: AuthUserCtx, @Query() query: MergedPrsQueryDto) {
    return this.github.getMergedPRs(user.userId, query.repo);
  }

  // ── PR attachment CRUD ──────────────────────────────────────────────────

  @Post('agreements/:id/milestones/:index/prs')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Attach a merged PR to a milestone' })
  @ApiParam({ name: 'id', description: 'Agreement UUID' })
  @ApiParam({ name: 'index', description: 'Milestone index (0-based)' })
  attachPR(
    @CurrentUser() user: AuthUserCtx,
    @Param('id', new ParseUUIDPipe()) agreementId: string,
    @Param('index', ParseIntPipe) milestoneIndex: number,
    @Body() dto: AttachPrDto,
  ) {
    return this.github.attachPR(user.userId, agreementId, milestoneIndex, dto);
  }

  @Delete('agreements/:id/milestones/:index/prs/:prId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Detach a PR from a milestone' })
  @ApiParam({ name: 'id', description: 'Agreement UUID' })
  @ApiParam({ name: 'index', description: 'Milestone index (0-based)' })
  @ApiParam({ name: 'prId', description: 'PR evidence UUID' })
  detachPR(
    @CurrentUser() user: AuthUserCtx,
    @Param('id', new ParseUUIDPipe()) agreementId: string,
    @Param('index', ParseIntPipe) milestoneIndex: number,
    @Param('prId', new ParseUUIDPipe()) prId: string,
  ) {
    return this.github.detachPR(user.userId, agreementId, milestoneIndex, prId);
  }

  @Get('agreements/:id/milestones/:index/prs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List PRs attached to a milestone' })
  @ApiParam({ name: 'id', description: 'Agreement UUID' })
  @ApiParam({ name: 'index', description: 'Milestone index (0-based)' })
  getAttachedPRs(
    @CurrentUser() user: AuthUserCtx,
    @Param('id', new ParseUUIDPipe()) agreementId: string,
    @Param('index', ParseIntPipe) milestoneIndex: number,
  ) {
    return this.github.getAttachedPRs(user.userId, agreementId, milestoneIndex);
  }
}
