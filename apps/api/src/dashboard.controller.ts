import { Controller, Get, Header } from "@nestjs/common";
import { DASHBOARD } from "./dashboard.js";

@Controller()
export class DashboardController {
  @Get()
  @Header("content-type", "text/html; charset=utf-8")
  panel(): string {
    return DASHBOARD;
  }
}
