import { SecurityScanResult } from '@app/models';
import { SecurityScanResultService } from '@app/services/security-scan-result/security-scan-result.service';
import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Crud, CrudController } from '@nestjsx/crud';

@Crud({
  query: {
    join: {
      scan: {
        eager: true,
      },
    },
  },
  model: {
    type: SecurityScanResult,
  },
})
@ApiTags('SecurityScanResult')
@Controller('security-scan-result')
export class SecurityScanResultController implements CrudController<SecurityScanResult> {
  constructor(public service: SecurityScanResultService) {}
}
