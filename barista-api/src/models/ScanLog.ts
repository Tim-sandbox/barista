import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, ManyToOne } from 'typeorm';
import { ModelBase } from './ModelBase';
import { Scan } from './Scan';

@Entity()
export class ScanLog extends ModelBase {
  @ApiProperty()
  @Column({ name: 'log', type: 'text', nullable: true })
  log: string;

  @ApiProperty({ type: type => Scan })
  @ManyToOne(
    type => Scan,
    scan => scan.securityScanResults,
    {
      onDelete: 'CASCADE',
    },
  )
  scan: Scan;
}
