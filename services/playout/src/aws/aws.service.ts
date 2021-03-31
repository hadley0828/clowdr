import { App } from "@aws-cdk/core";
import { CloudFront } from "@aws-sdk/client-cloudfront";
import { ElasticTranscoder } from "@aws-sdk/client-elastic-transcoder";
import { IAM } from "@aws-sdk/client-iam";
import { MediaLive } from "@aws-sdk/client-medialive";
import { MediaPackage } from "@aws-sdk/client-mediapackage";
import { SNS } from "@aws-sdk/client-sns";
import { Credentials as NewSdkCredentials } from "@aws-sdk/types";
import { RootLogger } from "@eropple/nestjs-bunyan";
import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import assert from "assert";
import { SdkProvider } from "aws-cdk/lib/api/aws-auth";
import { CloudFormationDeployments } from "aws-cdk/lib/api/cloudformation-deployments";
import { DeployStackResult } from "aws-cdk/lib/api/deploy-stack";
import AWS, { CredentialProviderChain } from "aws-sdk";
import * as Bunyan from "bunyan";
import { customAlphabet } from "nanoid";
import { AWS_MODULE_OPTIONS } from "../constants";
import { AwsModuleOptions } from "./aws.module";
import { ChannelStack, ChannelStackProps } from "./channelStack";

@Injectable()
export class AwsService implements OnModuleInit {
    private readonly logger: Bunyan;

    private readonly credentials: NewSdkCredentials;
    private readonly region: string;
    private iam: IAM;
    private elasticTranscoder: ElasticTranscoder;
    private mediaLive: MediaLive;
    private mediaPackage: MediaPackage;
    private cloudFront: CloudFront;
    private sns: SNS;

    constructor(
        @RootLogger() logger: Bunyan,
        @Inject(AWS_MODULE_OPTIONS) config: AwsModuleOptions,
        private configService: ConfigService
    ) {
        this.logger = logger.child({ component: this.constructor.name });

        this.credentials = config.credentials;
        this.region = config.region;
    }
    onModuleInit(): void {
        this.iam = new IAM({
            apiVersion: "2010-05-08",
            credentials: this.credentials,
            region: this.region,
        });

        this.elasticTranscoder = new ElasticTranscoder({
            apiVersion: "2012-09-25",
            credentials: this.credentials,
            region: this.region,
        });

        this.mediaLive = new MediaLive({
            apiVersion: "2017-10-14",
            credentials: this.credentials,
            region: this.region,
        });

        this.mediaPackage = new MediaPackage({
            apiVersion: "2017-10-14",
            credentials: this.credentials,
            region: this.region,
        });

        this.cloudFront = new CloudFront({
            apiVersion: "2020-05-31",
            credentials: this.credentials,
            region: this.region,
        });

        this.sns = new SNS({
            apiVersion: "2010-03-31",
            credentials: this.credentials,
            region: this.region,
        });
    }

    public shortId(length = 6): string {
        return `C${customAlphabet("abcdefghijklmnopqrstuvwxyz1234567890", length - 1)()}`;
    }

    public getHostUrl(): string {
        const hostDomain = this.configService.get<string>("HOST_DOMAIN");
        assert(hostDomain, "Missing HOST_DOMAIN.");
        const hostSecureProtocols = this.configService.get<string>("HOST_SECURE_PROTOCOLS") !== "false";

        return `${hostSecureProtocols ? "https" : "http"}://${hostDomain}`;
    }

    public async subscribeToTopic(topicArn: string, endpointUri: string): Promise<void> {
        const hostSecureProtocols = this.configService.get<string>("HOST_SECURE_PROTOCOLS") !== "false";

        await this.sns.subscribe({
            Protocol: hostSecureProtocols ? "https" : "http",
            TopicArn: topicArn,
            Endpoint: endpointUri,
        });
    }

    public async createNewChannelStack(
        roomId: string,
        roomName: string,
        conferenceId: string
    ): Promise<DeployStackResult> {
        const awsPrefix = this.configService.get<string>("AWS_PREFIX");
        assert(awsPrefix, "Missing AWS_PREFIX");
        const inputSecurityGroupId = this.configService.get<string>("AWS_MEDIALIVE_INPUT_SECURITY_GROUP_ID");
        assert(inputSecurityGroupId, "Missing AWS_MEDIALIVE_INPUT_SECURITY_GROUP_ID");
        const mediaLiveServiceRoleArn = this.configService.get<string>("AWS_MEDIALIVE_SERVICE_ROLE_ARN");
        assert(mediaLiveServiceRoleArn, "Missing AWS_MEDIALIVE_SERVICE_ROLE_ARN");
        const cloudFormationNotificationsTopicArn = this.configService.get<string>(
            "AWS_CLOUDFORMATION_NOTIFICATIONS_TOPIC_ARN"
        );
        assert(cloudFormationNotificationsTopicArn, "Missing AWS_CLOUDFORMATION_NOTIFICATIONS_TOPIC_ARN");
        const region = this.configService.get<string>("AWS_REGION");
        assert(region, "Missing AWS_REGION");
        const account = this.configService.get<string>("AWS_ACCOUNT_ID");
        assert(account, "Missing AWS_ACCOUNT_ID");

        const options: ChannelStackProps = {
            awsPrefix,
            generateId: this.shortId,
            inputSecurityGroupId,
            roomId,
            roomName,
            conferenceId,
            tags: {
                roomId,
                roomName,
                conferenceId,
            },
            env: {
                account,
                region,
            },
            description: `Broadcast channel stack for room ${roomId}`,
            mediaLiveServiceRoleArn,
        };

        this.logger.info("Starting deployment");
        const app = new App();
        const stack = new ChannelStack(app, `${awsPrefix}-room-${this.shortId()}`, options);

        const stackArtifact = app.synth().getStackByName(stack.stackName);
        const credentials = new AWS.Credentials({
            accessKeyId: this.credentials.accessKeyId,
            secretAccessKey: this.credentials.secretAccessKey,
        });
        const credentialProviderChain = new CredentialProviderChain();
        credentialProviderChain.providers.push(credentials);
        const sdkProvider = new SdkProvider(credentialProviderChain, region, {
            credentials,
        });
        const cloudFormation = new CloudFormationDeployments({ sdkProvider });
        return await cloudFormation.deployStack({
            stack: stackArtifact,
            notificationArns: [cloudFormationNotificationsTopicArn],
        });
    }
}
