import { IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// clientId: vom Gerät vergeben (UUID), damit ein zweiter Versuch aus der
// Offline-Warteschlange nichts doppelt anlegt
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

export class PostMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @Matches(CLIENT_ID)
  clientId?: string;
}

export class PostPhotoDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  @IsOptional()
  @Matches(CLIENT_ID)
  clientId?: string;
}

export class MessagesQueryDto {
  // Zeitpunkt der ältesten schon geladenen Nachricht (weiter zurückblättern)
  @IsOptional()
  @IsISO8601()
  before?: string;
}
