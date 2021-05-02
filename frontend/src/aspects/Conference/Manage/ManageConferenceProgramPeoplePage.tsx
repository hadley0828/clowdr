import { gql, Reference } from "@apollo/client";
import { ChevronDownIcon } from "@chakra-ui/icons";
import {
    Button,
    FormLabel,
    Heading,
    Input,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    Select,
    useColorModeValue,
    useToast,
} from "@chakra-ui/react";
import React, { LegacyRef, useCallback, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import {
    ManageProgramPeople_ProgramPersonFragment,
    ManageProgramPeople_ProgramPersonFragmentDoc,
    ManageProgramPeople_RegistrantFragment,
    Permissions_Permission_Enum,
    useManageProgramPeople_DeleteProgramPersonsMutation,
    useManageProgramPeople_InsertProgramPersonMutation,
    useManageProgramPeople_SelectAllPeopleQuery,
    useManageProgramPeople_SelectAllRegistrantsQuery,
    useManageProgramPeople_UpdateProgramPersonMutation,
} from "../../../generated/graphql";
import { TextColumnFilter } from "../../CRUDTable2/CRUDComponents";
import CRUDTable, {
    CellProps,
    ColumnHeaderProps,
    ColumnSpecification,
    Delete,
    Insert,
    RowSpecification,
    SortDirection,
    Update,
} from "../../CRUDTable2/CRUDTable2";
import PageNotFound from "../../Errors/PageNotFound";
import useQueryErrorToast from "../../GQL/useQueryErrorToast";
import { maybeCompare } from "../../Utils/maybeSort";
import { useTitle } from "../../Utils/useTitle";
import RequireAtLeastOnePermissionWrapper from "../RequireAtLeastOnePermissionWrapper";
import { useConference } from "../useConference";

// TODO: Handle duplicate email addresses (edit/create)
// TODO: Handle duplicate name+affiliation (edit/create)

gql`
    fragment ManageProgramPeople_Registrant on registrant_Registrant {
        id
        displayName
        invitation {
            id
            invitedEmailAddress
        }
        profile {
            registrantId
            affiliation
        }
    }

    fragment ManageProgramPeople_ProgramPerson on collection_ProgramPerson {
        id
        conferenceId
        name
        affiliation
        email
        originatingDataId
        registrantId
    }

    query ManageProgramPeople_SelectAllPeople($conferenceId: uuid!) {
        collection_ProgramPerson(where: { conferenceId: { _eq: $conferenceId } }) {
            ...ManageProgramPeople_ProgramPerson
        }
    }

    query ManageProgramPeople_SelectAllRegistrants($conferenceId: uuid!) {
        registrant_Registrant(where: { conferenceId: { _eq: $conferenceId } }) {
            ...ManageProgramPeople_Registrant
        }
    }

    mutation ManageProgramPeople_InsertProgramPerson($person: collection_ProgramPerson_insert_input!) {
        insert_collection_ProgramPerson_one(object: $person) {
            ...ManageProgramPeople_ProgramPerson
        }
    }

    mutation ManageProgramPeople_DeleteProgramPersons($ids: [uuid!] = []) {
        delete_collection_ProgramPerson(where: { id: { _in: $ids } }) {
            returning {
                id
            }
        }
    }

    mutation ManageProgramPeople_UpdateProgramPerson(
        $id: uuid!
        $name: String!
        $affiliation: String
        $email: String
        $registrantId: uuid
    ) {
        update_collection_ProgramPerson_by_pk(
            pk_columns: { id: $id }
            _set: { name: $name, affiliation: $affiliation, email: $email, registrantId: $registrantId }
        ) {
            ...ManageProgramPeople_ProgramPerson
        }
    }
`;

export default function ManageConferenceProgramPeoplePage(): JSX.Element {
    const conference = useConference();
    const title = useTitle(`Manage program people at ${conference.shortName}`);

    const { data: registrantsData } = useManageProgramPeople_SelectAllRegistrantsQuery({
        variables: {
            conferenceId: conference.id,
        },
    });

    const registrants = useMemo(() => (registrantsData ? [...registrantsData.Registrant] : []), [registrantsData]);
    const registrantOptions = useMemo(() => {
        return registrants
            .sort((x, y) => x.displayName.localeCompare(y.displayName))
            .map((person) => (
                <option key={person.id} value={person.id}>
                    {person.displayName}
                    {person.profile?.affiliation ? ` (${person.profile.affiliation})` : ""}
                    {person.invitation?.invitedEmailAddress ? ` <${person.invitation.invitedEmailAddress}>` : ""}
                </option>
            ));
    }, [registrants]);
    const forceReloadRef = useRef<() => void>(() => {
        /* EMPTY */
    });

    const row: RowSpecification<ManageProgramPeople_ProgramPersonFragment> = useMemo(
        () => ({
            getKey: (record) => record.id,
            canSelect: (_record) => true,
            pages: {
                defaultToLast: false,
            },
            invalid: (record) =>
                !record.name?.length
                    ? {
                          columnId: "name",
                          reason: "Name required",
                      }
                    : false,
        }),
        []
    );

    const columns: ColumnSpecification<ManageProgramPeople_ProgramPersonFragment>[] = useMemo(
        () => [
            {
                id: "name",
                defaultSortDirection: SortDirection.Asc,
                header: function NameHeader(props: ColumnHeaderProps<ManageProgramPeople_ProgramPersonFragment>) {
                    return props.isInCreate ? (
                        <FormLabel>Name</FormLabel>
                    ) : (
                        <Button size="xs" onClick={props.onClick}>
                            Name{props.sortDir !== null ? ` ${props.sortDir}` : undefined}
                        </Button>
                    );
                },
                get: (data) => data.name,
                set: (record, value: string | undefined) => {
                    record.name = value;
                },
                filterFn: (rows: Array<ManageProgramPeople_ProgramPersonFragment>, filterValue: string) => {
                    return rows.filter((row) => row.name.toLowerCase().includes(filterValue.toLowerCase()));
                },
                filterEl: TextColumnFilter,
                sort: (x: string | undefined, y: string | undefined) =>
                    maybeCompare(x, y, (a, b) => a.localeCompare(b)),
                cell: function ProgramPersonCell(
                    props: CellProps<Partial<ManageProgramPeople_ProgramPersonFragment>, string | undefined>
                ) {
                    return (
                        <Input
                            type="text"
                            value={props.value ?? ""}
                            onChange={(ev) => props.onChange?.(ev.target.value)}
                            onBlur={props.onBlur}
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.16)"
                            ref={props.ref as LegacyRef<HTMLInputElement>}
                        />
                    );
                },
            },
            {
                id: "affiliation",
                defaultSortDirection: SortDirection.Asc,
                header: function AffiliationHeader(
                    props: ColumnHeaderProps<ManageProgramPeople_ProgramPersonFragment>
                ) {
                    return props.isInCreate ? (
                        <FormLabel>Affiliation</FormLabel>
                    ) : (
                        <Button size="xs" onClick={props.onClick}>
                            Affiliation{props.sortDir !== null ? ` ${props.sortDir}` : undefined}
                        </Button>
                    );
                },
                get: (data) => data.affiliation,
                set: (record, value: string | undefined) => {
                    record.affiliation = value;
                },
                filterFn: (rows: Array<ManageProgramPeople_ProgramPersonFragment>, filterValue: string) => {
                    return rows.filter((row) =>
                        row.affiliation
                            ? row.affiliation.toLowerCase().includes(filterValue.toLowerCase())
                            : filterValue === ""
                    );
                },
                filterEl: TextColumnFilter,
                sort: (x: string | undefined, y: string | undefined) =>
                    maybeCompare(x, y, (a, b) => a.localeCompare(b)),
                cell: function ProgramPersonCell(
                    props: CellProps<Partial<ManageProgramPeople_ProgramPersonFragment>, string | undefined>
                ) {
                    return (
                        <Input
                            type="text"
                            value={props.value ?? ""}
                            onChange={(ev) => props.onChange?.(ev.target.value)}
                            onBlur={props.onBlur}
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.16)"
                            ref={props.ref as LegacyRef<HTMLInputElement>}
                        />
                    );
                },
            },
            {
                id: "email",
                header: function AffiliationHeader(
                    props: ColumnHeaderProps<ManageProgramPeople_ProgramPersonFragment>
                ) {
                    return props.isInCreate ? (
                        <FormLabel>Email</FormLabel>
                    ) : (
                        <Button size="xs" onClick={props.onClick}>
                            Email{props.sortDir !== null ? ` ${props.sortDir}` : undefined}
                        </Button>
                    );
                },
                get: (data) => data.email,
                set: (record, value: string | undefined) => {
                    record.email = value;
                },
                filterFn: (rows: Array<ManageProgramPeople_ProgramPersonFragment>, filterValue: string) => {
                    return rows.filter((row) =>
                        row.email ? row.email.toLowerCase().includes(filterValue.toLowerCase()) : filterValue === ""
                    );
                },
                filterEl: TextColumnFilter,
                sort: (x: string | undefined, y: string | undefined) =>
                    maybeCompare(x, y, (a, b) => a.localeCompare(b)),
                cell: function ProgramPersonCell(
                    props: CellProps<Partial<ManageProgramPeople_ProgramPersonFragment>, string | undefined>
                ) {
                    return (
                        <Input
                            type="email"
                            value={props.value ?? ""}
                            onChange={(ev) => props.onChange?.(ev.target.value)}
                            onBlur={props.onBlur}
                            border="1px solid"
                            borderColor="rgba(255, 255, 255, 0.16)"
                            ref={props.ref as LegacyRef<HTMLInputElement>}
                        />
                    );
                },
            },
            {
                id: "Registrant",
                header: function RegistrantHeader(props: ColumnHeaderProps<ManageProgramPeople_ProgramPersonFragment>) {
                    return props.isInCreate ? (
                        <FormLabel>Registrant</FormLabel>
                    ) : (
                        <Button size="xs" onClick={props.onClick}>
                            Registrant{props.sortDir !== null ? ` ${props.sortDir}` : undefined}
                        </Button>
                    );
                },
                get: (data) => registrants.find((x) => x.id === data.registrantId),
                set: (record, value: ManageProgramPeople_RegistrantFragment | undefined) => {
                    record.registrantId = value?.id;
                },
                sort: (
                    x: ManageProgramPeople_RegistrantFragment | undefined,
                    y: ManageProgramPeople_RegistrantFragment | undefined
                ) =>
                    x && y
                        ? x.displayName.localeCompare(y.displayName) ||
                          maybeCompare(x.profile?.affiliation, y.profile?.affiliation, (a, b) => a.localeCompare(b))
                        : x
                        ? 1
                        : y
                        ? -1
                        : 0,
                cell: function ProgramPersonCell({
                    value,
                    onChange,
                    onBlur,
                    ref,
                }: CellProps<
                    Partial<ManageProgramPeople_ProgramPersonFragment>,
                    ManageProgramPeople_RegistrantFragment | undefined
                >) {
                    return (
                        <Select
                            value={value?.id ?? ""}
                            onChange={(ev) => onChange?.(registrants.find((x) => x.id === ev.target.value))}
                            onBlur={onBlur}
                            ref={ref as LegacyRef<HTMLSelectElement>}
                        >
                            <option value="">Select a registrant</option>
                            {registrantOptions}
                        </Select>
                    );
                },
            },
        ],
        [registrantOptions, registrants]
    );

    const {
        loading: loadingAllProgramPersons,
        error: errorAllProgramPersons,
        data: allProgramPersons,
        refetch,
    } = useManageProgramPeople_SelectAllPeopleQuery({
        fetchPolicy: "network-only",
        variables: {
            conferenceId: conference.id,
        },
    });
    useQueryErrorToast(errorAllProgramPersons, false);
    const data = useMemo(() => [...(allProgramPersons?.ProgramPerson ?? [])], [allProgramPersons?.ProgramPerson]);

    const [insertProgramPerson, insertProgramPersonResponse] = useManageProgramPeople_InsertProgramPersonMutation();
    const [deleteProgramPersons, deleteProgramPersonsResponse] = useManageProgramPeople_DeleteProgramPersonsMutation();
    const [updateProgramPerson, updateProgramPersonResponse] = useManageProgramPeople_UpdateProgramPersonMutation();

    const insert: Insert<ManageProgramPeople_ProgramPersonFragment> = useMemo(
        () => ({
            ongoing: insertProgramPersonResponse.loading,
            generateDefaults: () => {
                const programpersonId = uuidv4();
                return {
                    id: programpersonId,
                    conferenceId: conference.id,
                };
            },
            makeWhole: (d) => (d.name?.length ? (d as ManageProgramPeople_ProgramPersonFragment) : undefined),
            start: (record) => {
                insertProgramPerson({
                    variables: {
                        person: {
                            id: record.id,
                            conferenceId: conference.id,
                            affiliation: record.affiliation,
                            registrantId: record.registrantId,
                            email: record.email,
                            name: record.name,
                        },
                    },
                    update: (cache, { data: _data }) => {
                        if (_data?.insert_ProgramPerson_one) {
                            const data = _data.insert_ProgramPerson_one;
                            cache.writeFragment({
                                data,
                                fragment: ManageProgramPeople_ProgramPersonFragmentDoc,
                                fragmentName: "ManageProgramPeople_ProgramPerson",
                            });
                        }
                    },
                });
            },
        }),
        [conference.id, insertProgramPerson, insertProgramPersonResponse.loading]
    );

    const startUpdate = useCallback(
        async (record: ManageProgramPeople_ProgramPersonFragment) => {
            return updateProgramPerson({
                variables: {
                    id: record.id,
                    name: record.name,
                    affiliation: record.affiliation !== "" ? record.affiliation ?? null : null,
                    registrantId: record.registrantId ?? null,
                    email: record.email !== "" ? record.email ?? null : null,
                },
                optimisticResponse: {
                    update_ProgramPerson_by_pk: record,
                },
                update: (cache, { data: _data }) => {
                    if (_data?.update_ProgramPerson_by_pk) {
                        const data = _data.update_ProgramPerson_by_pk;
                        cache.writeFragment({
                            data,
                            fragment: ManageProgramPeople_ProgramPersonFragmentDoc,
                            fragmentName: "ManageProgramPeople_ProgramPerson",
                        });
                    }
                },
            });
        },
        [updateProgramPerson]
    );

    const update: Update<ManageProgramPeople_ProgramPersonFragment> = useMemo(
        () => ({
            ongoing: updateProgramPersonResponse.loading,
            start: startUpdate,
        }),
        [updateProgramPersonResponse.loading, startUpdate]
    );

    const deleteP: Delete<ManageProgramPeople_ProgramPersonFragment> = useMemo(
        () => ({
            ongoing: deleteProgramPersonsResponse.loading,
            start: (keys) => {
                deleteProgramPersons({
                    variables: {
                        ids: keys,
                    },
                    update: (cache, { data: _data }) => {
                        if (_data?.delete_ProgramPerson) {
                            const data = _data.delete_ProgramPerson;
                            const deletedIds = data.returning.map((x) => x.id);
                            cache.modify({
                                fields: {
                                    collection_ProgramPerson(existingRefs: Reference[] = [], { readField }) {
                                        deletedIds.forEach((x) => {
                                            cache.evict({
                                                id: x.id,
                                                fieldName: "ManageProgramPeople_ProgramPerson",
                                                broadcast: true,
                                            });
                                        });
                                        return existingRefs.filter((ref) => !deletedIds.includes(readField("id", ref)));
                                    },
                                },
                            });
                        }
                    },
                });
            },
        }),
        [deleteProgramPersons, deleteProgramPersonsResponse.loading]
    );

    const toast = useToast();
    const autoLink = useCallback(
        async (mode: "email" | "name_affiliation" | "name_only") => {
            const allUnmatched = data.filter((x) => !x.registrantId);
            let matchCount = 0;
            await Promise.all(
                allUnmatched.map(async (unmatched) => {
                    let registrant: ManageProgramPeople_RegistrantFragment | undefined;

                    switch (mode) {
                        case "email":
                            if (unmatched.email) {
                                registrant = registrants.find(
                                    (x) => x.invitation?.invitedEmailAddress === unmatched.email
                                );
                            }
                            break;
                        case "name_affiliation":
                            if (unmatched.name && unmatched.affiliation) {
                                const name = unmatched.name.toLowerCase().trim();
                                const affil = unmatched.affiliation.toLowerCase().trim();
                                registrant = registrants.find(
                                    (x) =>
                                        x.displayName.toLowerCase().trim() === name &&
                                        x.profile?.affiliation &&
                                        x.profile.affiliation.toLowerCase().trim() === affil
                                );
                            }
                            break;
                        case "name_only":
                            if (unmatched.name) {
                                const name = unmatched.name.toLowerCase().trim();
                                registrant = registrants.find((x) => x.displayName.toLowerCase().trim() === name);
                            }
                            break;
                    }

                    if (registrant) {
                        matchCount++;
                        await startUpdate({
                            ...unmatched,
                            registrantId: registrant.id,
                        });
                    }
                })
            );

            const unmatchCount = allUnmatched.length - matchCount;
            toast({
                title: `Matched ${matchCount} people to registrants.`,
                description: `${unmatchCount} remain unmatched.`,
                duration: 4000,
                isClosable: true,
                position: "top",
                status: matchCount > 0 ? "success" : "info",
            });

            await refetch();

            setTimeout(() => {
                forceReloadRef.current();
            }, 100);
        },
        [refetch, data, toast, registrants, startUpdate]
    );

    const green = useColorModeValue("green.100", "green.700");
    const greenAlt = useColorModeValue("green.200", "green.600");
    const buttons = useMemo(
        () => [
            {
                render: function AutoLinkMenu() {
                    return (
                        <Menu>
                            <MenuButton as={Button} rightIcon={<ChevronDownIcon />}>
                                Auto-link to registrants
                            </MenuButton>
                            <MenuList>
                                <MenuItem
                                    onClick={() => autoLink("email")}
                                    bgColor={green}
                                    _hover={{
                                        bgColor: greenAlt,
                                    }}
                                    _focus={{
                                        bgColor: greenAlt,
                                    }}
                                >
                                    By email (recommended)
                                </MenuItem>
                                <MenuItem onClick={() => autoLink("name_affiliation")}>
                                    By name and affiliation (usually ok)
                                </MenuItem>
                                <MenuItem onClick={() => autoLink("name_only")}>
                                    By name only (not recommended)
                                </MenuItem>
                            </MenuList>
                        </Menu>
                    );
                },
            },
        ],
        [autoLink, green, greenAlt]
    );

    const pageSizes = useMemo(() => [10, 20, 35, 50], []);

    return (
        <RequireAtLeastOnePermissionWrapper
            permissions={[
                Permissions_Permission_Enum.ConferenceManageAttendees,
                Permissions_Permission_Enum.ConferenceManageRoles,
                Permissions_Permission_Enum.ConferenceManageGroups,
            ]}
            componentIfDenied={<PageNotFound />}
        >
            {title}
            <Heading as="h1" fontSize="2.3rem" lineHeight="3rem">
                Manage {conference.shortName}
            </Heading>
            <Heading as="h2" fontSize="1.7rem" lineHeight="2.4rem" fontStyle="italic">
                Program People
            </Heading>
            {loadingAllProgramPersons && !allProgramPersons?.ProgramPerson ? (
                <></>
            ) : errorAllProgramPersons ? (
                <>An error occurred loading in data - please see further information in notifications.</>
            ) : (
                <></>
            )}
            <CRUDTable
                data={!loadingAllProgramPersons && (allProgramPersons?.ProgramPerson ? data : null)}
                tableUniqueName="ManageConferenceProgramPeople"
                row={row}
                columns={columns}
                pageSizes={pageSizes}
                insert={insert}
                update={update}
                delete={deleteP}
                buttons={buttons}
                forceReload={forceReloadRef}
            />
        </RequireAtLeastOnePermissionWrapper>
    );
}
