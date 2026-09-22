import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PASSWORD_MIN_LENGTH, trimEmail } from '../../auth/passwords';

export class CreateUserDto {
  @Transform(trimEmail)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  // Startpasswort, das der Admin dem neuen Nutzer mitteilt. bcrypt
  // verarbeitet nur 72 Bytes – längere Passwörter ablehnen statt kürzen.
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];

  // Legt gleich ein verknüpftes Mitarbeiterprofil an (für Zeiterfassung).
  @IsOptional()
  @IsBoolean()
  createEmployee?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  password!: string;
}
