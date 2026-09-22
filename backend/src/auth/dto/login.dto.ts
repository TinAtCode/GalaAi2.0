import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PASSWORD_MIN_LENGTH, trimEmail } from '../passwords';

export class LoginDto {
  @Transform(trimEmail)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  // bcrypt verarbeitet nur die ersten 72 Bytes – längere Passwörter ablehnen,
  // statt still abzuschneiden.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  newPassword!: string;
}
