import { Controller, Get } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";

@ApiExcludeController()
@Controller()
export class RootController {
  @Get()
  index() {
    return {
      name: "Thalos API",
      docs: "/v1/docs",
      openapiJson: "/v1/docs-json",
    };
  }
}
