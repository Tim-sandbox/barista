import { OutputFormatType } from '@app/models/OutputFormatType';
import { OutputFormatTypeService } from '@app/services/output-format-type/output-format-type.service';
import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Crud, CrudController } from '@nestjsx/crud';

@Crud({
  model: {
    type: OutputFormatType,
  },
})
@ApiTags('OutputFormatType')
@Controller('output-format-type')
export class OutputFormatTypeController implements CrudController<OutputFormatType> {
  constructor(public service: OutputFormatTypeService) {}
}
