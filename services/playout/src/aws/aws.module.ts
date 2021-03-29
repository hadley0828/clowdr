import { Bunyan, RootLogger } from "@eropple/nestjs-bunyan";
import {
    DynamicModule,
    FactoryProvider,
    Global,
    MiddlewareConsumer,
    Module,
    ModuleMetadata,
    NestModule,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import assert from "assert";
import { AWS_MODULE_OPTIONS } from "../constants";
import { AwsController } from "./aws.controller";
import { AwsService } from "./aws.service";
import { SnsNotificationMiddleware } from "./sns-notification.middleware";

export type AwsModuleOptions = {
    credentials: {
        accessKeyId: string;
        secretAccessKey: string;
    };
    prefix: string;
    region: string;
    mediaLiveServiceRoleArn: string;
};

@Global()
@Module({
    providers: [AwsService],
    exports: [AwsService],
    controllers: [AwsController],
})
export class AwsModule implements NestModule {
    static forRoot(config: AwsModuleOptions): DynamicModule {
        return {
            module: AwsModule,
            imports: [],
            providers: [
                AwsService,
                {
                    provide: AWS_MODULE_OPTIONS,
                    useValue: config,
                },
            ],
            exports: [AwsService],
        };
    }

    static forRootAsync(
        config: Omit<FactoryProvider<AwsModuleOptions | Promise<AwsModuleOptions>>, "provide"> &
            Pick<ModuleMetadata, "imports">
    ): DynamicModule {
        return {
            module: AwsModule,
            imports: config.imports ?? [],
            providers: [
                AwsService,
                {
                    provide: AWS_MODULE_OPTIONS,
                    useFactory: config.useFactory,
                    inject: config.inject,
                },
            ],
            exports: [AwsService],
        };
    }

    private readonly logger: Bunyan;

    constructor(private awsService: AwsService, @RootLogger() logger: Bunyan, private configService: ConfigService) {
        this.logger = logger.child({ component: this.constructor.name });
    }

    public configure(consumer: MiddlewareConsumer): void {
        consumer.apply(SnsNotificationMiddleware).forRoutes(AwsController);
    }

    async onModuleInit(): Promise<void> {
        this.logger.info("Subscribing to CloudFormation SNS notifications");
        const hostUrl = this.awsService.getHostUrl();
        const cloudFormationNotificationUrl = new URL(hostUrl);
        cloudFormationNotificationUrl.pathname = "/aws/cloudformation/notify";

        const cloudFormationNotificationsTopicArn = this.configService.get<string>(
            "AWS_CLOUDFORMATION_NOTIFICATIONS_TOPIC_ARN"
        );
        assert(cloudFormationNotificationsTopicArn, "Missing AWS_CLOUDFORMATION_NOTIFICATIONS_TOPIC_ARN");

        await this.awsService.subscribeToTopic(
            cloudFormationNotificationsTopicArn,
            cloudFormationNotificationUrl.toString()
        );
    }
}
