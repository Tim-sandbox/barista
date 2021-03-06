import { LicenseScanResultItem, SecurityScanResultItem } from '@app/models';
import { LogProjectChangeCommand } from '@app/models/commands/LogProjectChangeCommand';
import { ProjectDistinctLicenseDto, ProjectDistinctVulnerabilityDto } from '@app/models/DTOs';
import { LicenseDto } from '@app/models/DTOs/LicenseDto';
import { LicenseModuleDto } from '@app/models/DTOs/LicenseModuleDto';
import { ObligationSearchDto } from '@app/models/DTOs/ObligationSearchDto';
import { ProjectDistinctSeverityDto } from '@app/models/DTOs/ProjectDistinctSeverityDto';
import { ProjectScanStateDto } from '@app/models/DTOs/ProjectScanStateDto';
import { ScanBranchDto } from '@app/models/DTOs/ScanBranchDto';
import { Project } from '@app/models/Project';
import { LicenseScanResultItemService } from '@app/services/license-scan-result-item/license-scan-result-item.service';
import { ProjectScanStatusTypeService } from '@app/services/project-scan-status-type/project-scan-status-type.service';
import { ProjectService } from '@app/services/project/project.service';
import { SecurityScanResultItemService } from '@app/services/security-scan-result-item/security-scan-result-item.service';
import PaginateArrayResult, { EmptyPaginateResult } from '@app/shared/util/paginate-array-result';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  Header,
  Res,
  Logger,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import {
  Crud,
  CrudController,
  CrudRequest,
  CrudRequestInterceptor,
  GetManyDefaultResponse,
  Override,
  ParsedBody,
  ParsedRequest,
} from '@nestjsx/crud';
import gitP, { SimpleGit } from 'simple-git/promise';
import { Response } from 'express';
import { Swagger } from '@nestjsx/crud/lib/crud';

@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
@Crud({
  query: {
    join: {
      packageManager: {
        eager: true,
        exclude: ['createdAt', 'updatedAt'],
      },
      scans: {
        eager: true,
        allow: ['id'],
      },
      projectStatus: {
        eager: true,
        exclude: ['createdAt', 'updatedAt'],
      },
      outputFormat: {
        eager: true,
        exclude: ['createdAt', 'updatedAt'],
      },
      deploymentType: {
        eager: true,
        exclude: ['createdAt', 'updatedAt'],
      },
      developmentType: {
        eager: true,
        exclude: ['createdAt', 'updatedAt'],
      },
    },
    sort: [
      {
        field: 'createdAt',
        order: 'ASC',
      },
    ],
  },
  routes: {
    exclude: ['createOneBase'],
  },
  model: {
    type: Project,
  },
})
@ApiTags('Project')
@Controller('project')
export class ProjectController implements CrudController<Project> {
  constructor(
    public service: ProjectService,
    private licenseScanResultItemService: LicenseScanResultItemService,
    private securityScanResultItemService: SecurityScanResultItemService,
    private commandBus: CommandBus,
  ) {
    const metadata = Swagger.getParams(this.getProjectsWithStatus);
    const queryParamsMeta = Swagger.createQueryParamsMeta('getManyBase');
    Swagger.setParams([...metadata, ...queryParamsMeta], this.getProjectsWithStatus);
  }

  get base(): CrudController<Project> {
    return this;
  }
  logger = new Logger('ProjectContoller');
  private git: SimpleGit = gitP();

  @Get('/:id/bill-of-materials/licenses')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [LicenseScanResultItem] })
  async bomLicenses(
    @Param('id') id: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('filterText') filterText: string,
  ): Promise<GetManyDefaultResponse<LicenseScanResultItem>> {
    const project = await this.service.db.findOne(Number(id));
    const scan = await this.service.latestCompletedScan(project);
    if (scan) {
      const query = await this.licenseScanResultItemService.bomLicenseResultItemQuery(scan, filterText);
      return PaginateArrayResult(query, +page, +pageSize);
    } else {
      return EmptyPaginateResult();
    }
  }

  @Get('/:id/bill-of-materials/licenses-only')
  @ApiResponse({ status: 200, type: LicenseDto, isArray: true })
  async bomLicensesOnly(
    @Param('id') id: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('filterText') filterText: string,
  ): Promise<GetManyDefaultResponse<LicenseDto>> {
    return await this.licenseScanResultItemService.bomLicensesOnly(+id, page, pageSize, filterText);
  }

  @Get('/:id/bill-of-materials/modules-from-license/:licenseId')
  @ApiResponse({ status: 200, type: LicenseModuleDto, isArray: true })
  async bomModulesFromLicense(
    @Param('id') id: string,
    @Param('licenseId') licenseId: number,
    @Query('page') page: number = 0,
    @Query('pageSize') pageSize: number = 50,
    @Query('filterText') filterText: string = '',
  ): Promise<GetManyDefaultResponse<LicenseModuleDto>> {
    return await this.licenseScanResultItemService.bomModulesFromLicense(+id, licenseId, page, pageSize, filterText);
  }

  @Get('/:id/bill-of-materials/vulnerabilities')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [SecurityScanResultItem] })
  async bomVulnerabilities(
    @Param('id') id: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('filterText') filterText: string,
  ): Promise<GetManyDefaultResponse<SecurityScanResultItem>> {
    const project = await this.service.db.findOne(Number(id));
    const scan = await this.service.latestCompletedScan(project);
    if (scan) {
      const query = await this.securityScanResultItemService.bomSecurityResultItemQuery(scan, filterText);

      return PaginateArrayResult(query, +page, +pageSize);
    } else {
      return EmptyPaginateResult();
    }
  }

  @Override()
  async createOne(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: Project, @Request() request: any) {
    const project = await this.base.createOneBase(req, dto);
    const { id } = request.user;
    await this.commandBus.execute(
      new LogProjectChangeCommand(
        project.id,
        LogProjectChangeCommand.Actions.projectCreated,
        `Project [${project.name}] created.`,
        id,
      ),
    );

    return project;
  }

  @Post('/')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: Project })
  async createOneProject(
    @Body() dto: Project,
    @ParsedRequest() req: CrudRequest,
    @Request() request: any,
  ): Promise<Project> {
    const { id } = request.user;
    dto.userId = id;
    dto.name = dto.name.replace('(', '-').replace(')', '-');
    const project = await this.service.createOne(req, dto);

    await this.commandBus.execute(
      new LogProjectChangeCommand(
        project.id,
        LogProjectChangeCommand.Actions.projectCreated,
        `Project [${project.name}] created.`,
        id,
      ),
    );

    return project;
  }

  @Get('/search')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [Project] })
  async filteredProjects(
    @Query('filterText') filter: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
    @Query('developmentType') developmentType: string,
  ): Promise<GetManyDefaultResponse<Project>> {
    const query = await this.service.db
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.developmentType', 'developmentType')
      .where('(lower(name) like :filter or lower(git_url) like :filter) AND developmentType.code = :code', {
        filter: '%' + filter.toLocaleLowerCase() + '%',
        code: developmentType || 'organization',
      });

    return await PaginateArrayResult(query, +page, +pageSize);
  }

  @Get('/projects-with-statuses')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: Project, isArray: true })
  @ApiQuery({
    name: 'applyUserFilter',
    required: false,
    type: String, // Boolean doesn't work....always becomes a string...WTF?
  })
  async getProjectsWithStatus(
    @ParsedRequest() req: CrudRequest,
    @Query('applyUserFilter') applyUserFilter: string = 'false',
    @Request() request,
  ): Promise<Project[]> {
    const { parsed, options } = req;

    let userId = null;

    if (applyUserFilter === 'true') {
      userId = request.user.groups;
      userId.push(request.user.id);
    }

    const answer = await this.service.getProjectsMany(parsed, options, userId);
    return answer;
  }

  @Get('/validGithubRepo')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200 })
  async getvalidGitRepo(@Query('githubUrl') gitUrl: string) {
    const project = new Project();
    project.gitUrl = gitUrl;

    const gitUrl1 = await this.service.gitUrlAuthForProject(project);
    const gitOptions = [];
    gitOptions.push(gitUrl1);
    try {
      await this.git.listRemote(gitOptions);
      return 'success';
    } catch (e) {
      this.logger.error(e);
      return 'error';
    }
  }

  @Get('/:id/gitbranches')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [ScanBranchDto] })
  async getGitBranches(@Param('id') id: string): Promise<ScanBranchDto[]> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      const gitUrl = await this.service.gitUrlAuthForProject(project);
      const gitOptions = [];
      gitOptions.push(gitUrl);

      const branches = this.git.listRemote(gitOptions);
      const array = (await branches).substring(1, (await branches).length - 1).split('\n');
      const branchesAndTags = [];
      array.forEach((element) => {
        const branch = element.indexOf('refs/heads/');
        const branchName = element.substring(branch + 11);
        const scanBranchDto = new ScanBranchDto();
        if (branch > 0) {
          scanBranchDto.branch = branchName;
          branchesAndTags.push(scanBranchDto);
        }
        // const tag = element.indexOf('refs/tags/');
        // const tagName = element.substring(tag + 12);
        // if (tag > 0) {
        //   scanBranchDto.branch = tagName;
        //   branchesAndTags.push(scanBranchDto);
        // }
      });
      return branchesAndTags;
    }
  }

  @Get('/:id/stats/licenses')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [ProjectDistinctLicenseDto] })
  async licenses(@Param('id') id: string): Promise<ProjectDistinctLicenseDto[]> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      return this.service.distinctLicenses(project);
    } else {
      return [];
    }
  }

  @Get('/:id/obligations')
  @UseInterceptors(CrudRequestInterceptor)
  async obligations(@Param('id') id: string): Promise<any> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      return this.service.distinctObligations(project);
    } else {
      return [];
    }
  }

  @Get('/:id/attributions')
  @UseInterceptors(CrudRequestInterceptor)
  async attributions(@Param('id') id: string): Promise<any> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      return this.service.getprojectAttribution(project);
    } else {
      return [];
    }
  }

  @Get('/:id/attributions/download')
  @Header('Content-Type', 'text/plain')
  @Header('Content-Disposition', 'attachment; filename=attribution.txt')
  async attributionsDownload(@Param('id') id: string, @Res() res: Response): Promise<any> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      const attribution = await this.service.getprojectAttribution(project);
      return res.status(200).send(attribution.licenseText).end();
    }
  }

  @Get('/:id/stats/project-scan-status')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: ProjectScanStateDto })
  async projectScanStatus(@Param('id') id: string): Promise<ProjectScanStateDto> {
    const project = await this.service.db.findOne(Number(id));
    const projectStatus = new ProjectScanStateDto();

    projectStatus.licenseStatus = await ProjectScanStatusTypeService.Unknown();
    projectStatus.securityStatus = await ProjectScanStatusTypeService.Unknown();

    if (project) {
      projectStatus.projectId = project.id;
      projectStatus.licenseStatus = await this.service.highestLicenseStatus(project);
      projectStatus.securityStatus = await this.service.highestSecurityStatus(project);
    }

    return projectStatus;
  }

  @Get('/:id/stats/severities')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [ProjectDistinctSeverityDto] })
  async severities(@Param('id') id: string): Promise<ProjectDistinctSeverityDto[]> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      return this.service.distinctSeverities(project);
    } else {
      return [];
    }
  }

  @Get('/:id/unique-bom-obligations')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: ObligationSearchDto, isArray: true })
  async uniqueBomObligations(
    @Param('id') id: number,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number,
  ): Promise<GetManyDefaultResponse<ObligationSearchDto>> {
    return await this.service.uniqueBomObligations(+id, +page, +pageSize);
  }

  @Override()
  async updateOne(@ParsedRequest() req: CrudRequest, @ParsedBody() dto: Project, @Request() request: any) {
    const { id } = request.user;
    await this.commandBus.execute(
      new LogProjectChangeCommand(
        dto.id,
        LogProjectChangeCommand.Actions.projectDetailsUpdated,
        'Project details have been updated.',
        id,
      ),
    );
    return this.base.updateOneBase(req, dto);
  }

  @Get('/:id/stats/vulnerabilities')
  @UseInterceptors(CrudRequestInterceptor)
  @ApiResponse({ status: 200, type: [ProjectDistinctVulnerabilityDto] })
  async vulnerabilities(@Param('id') id: string): Promise<ProjectDistinctVulnerabilityDto[]> {
    const project = await this.service.db.findOne(Number(id));
    if (project) {
      return this.service.distinctVulnerabilities(project);
    } else {
      return [];
    }
  }
}
