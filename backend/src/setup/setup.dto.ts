import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class FirstSetupDto {
  // Einrichtungscode aus dem Startskript (SETUP_CODE)
  @IsString()
  @MaxLength(100)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;
}
