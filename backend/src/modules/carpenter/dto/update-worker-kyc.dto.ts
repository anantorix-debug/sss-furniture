import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

// Every field is optional; '' or null clears it. Numbers are normalised
// before checking (spaces/hyphens removed, letters upper-cased) so
// "1234 5678 9012" and "abcde1234f" are accepted as typed.
const digitsOnly = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') || null : value);
const upperNoSpace = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() || null : value);
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class UpdateWorkerKycDto {
  @Transform(digitsOnly)
  @ValidateIf((_, v) => v != null)
  @Matches(/^[2-9]\d{11}$/, { message: 'Aadhaar number must be 12 digits (it never starts with 0 or 1)' })
  @IsOptional()
  aadhaarNumber?: string | null;

  @Transform(upperNoSpace)
  @ValidateIf((_, v) => v != null)
  @Matches(/^[A-Z]{5}\d{4}[A-Z]$/, { message: 'PAN must look like ABCDE1234F (5 letters, 4 digits, 1 letter)' })
  @IsOptional()
  panNumber?: string | null;

  @Transform(trimmed)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  bankAccountHolder?: string | null;

  @Transform(digitsOnly)
  @ValidateIf((_, v) => v != null)
  @Matches(/^\d{9,18}$/, { message: 'Bank account number must be 9 to 18 digits' })
  @IsOptional()
  bankAccountNumber?: string | null;

  @Transform(upperNoSpace)
  @ValidateIf((_, v) => v != null)
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'IFSC must look like SBIN0001234 (4 letters, 0, then 6 letters/digits)' })
  @IsOptional()
  bankIfsc?: string | null;

  @Transform(trimmed)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  bankName?: string | null;

  @Transform(trimmed)
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  bankBranch?: string | null;
}
