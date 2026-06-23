import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerificationChallengeQueryDto {
  @ApiProperty({
    example: 'GA7QYNF7SOWQ3GLR2BGMZEHHHVSH3VK4UFR2QPYDQGPHK3WSALDQXJZN',
    description: 'Stellar public key (G..., 56 chars)',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'address must be a valid Stellar public key (G..., 56 chars)',
  })
  address: string;
}
