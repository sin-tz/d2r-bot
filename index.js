const { 
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    ChannelType,
    PermissionsBitField
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.TOKEN;

let runs = {};
let userRuns = {};

// 🔥 STARTUP + CLEANUP
client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const guilds = client.guilds.cache;

    for (const guild of guilds.values()) {
        const channels = await guild.channels.fetch();

        channels.forEach(channel => {
            if (channel && channel.name && channel.name.startsWith("run-")) {
                channel.delete().catch(() => {});
            }
        });
    }

    console.log("Cleaned up old run channels");
});

// BUTTONS
function mainButtons(runId, isFull) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_${runId}`)
            .setLabel(isFull ? "FULL" : "Join")
            .setStyle(ButtonStyle.Success)
            .setDisabled(isFull),

        new ButtonBuilder()
            .setCustomId(`leave_${runId}`)
            .setLabel("Leave")
            .setStyle(ButtonStyle.Danger)
    );
}

function joinOnlyButton(runId, isFull) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_${runId}`)
            .setLabel(isFull ? "FULL" : "Join")
            .setStyle(ButtonStyle.Success)
            .setDisabled(isFull)
    );
}

// 🔥 UPDATE MAIN MESSAGE (keeps ALERT style)
async function updateRunMessage(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const channel = interaction.channel;
    const msg = await channel.messages.fetch(run.messageId).catch(() => null);
    if (!msg) return;

    const full = run.players.length >= run.max;
    const spotsLeft = run.max - run.players.length;

    await msg.edit({
        content: `🚨 **NEW RUN ALERT!**
Join Terror Zone Runs on Non-Ladder hosted by <@${run.host}>. There are ${spotsLeft} spots left.`,
        components: [mainButtons(runId, full)]
    });
}

client.on(Events.InteractionCreate, async interaction => {

    if (interaction.isChatInputCommand()) {

        // HOST
        if (interaction.commandName === 'host') {

            if (userRuns[interaction.user.id]) {
                return interaction.reply({ content: "You are already in a run.", ephemeral: true });
            }

            await interaction.deferReply();

            const runId = Date.now();
            const host = interaction.user;

            const game = `run-${Math.floor(Math.random() * 1000)}`;
            const pass = Math.floor(100 + Math.random() * 900);

            const channel = await interaction.guild.channels.create({
                name: game,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: host.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });

            runs[runId] = {
                host: host.id,
                players: [host.id],
                max: 8,
                channelId: channel.id,
                messageId: null,
                game,
                pass
            };

            userRuns[host.id] = runId;

            await channel.send(`Game: **${game}**\nPassword: **${pass}**`);

            const spotsLeft = runs[runId].max - runs[runId].players.length;

            const msg = await interaction.editReply({
                content: `🚨 **NEW RUN ALERT!**
Join Terror Zone Runs on Non-Ladder hosted by <@${host.id}>. There are ${spotsLeft} spots left.`,
                components: [mainButtons(runId, false)]
            });

            runs[runId].messageId = msg.id;

            // AUTO DELETE AFTER 45 MIN
            setTimeout(async () => {
                const run = runs[runId];
                if (!run) return;

                const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
                if (channel) {
                    await channel.send("⏰ Run expired after 45 minutes. Closing...");
                    await channel.delete().catch(() => {});
                }

                run.players.forEach(u => delete userRuns[u]);
                delete runs[runId];

            }, 45 * 60 * 1000);

            // PRIVATE END BUTTON
            await interaction.followUp({
                content: "End your run:",
                ephemeral: true,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`end_${runId}`)
                            .setLabel("End Run")
                            .setStyle(ButtonStyle.Secondary)
                    )
                ]
            });
        }

        // RUNS
        if (interaction.commandName === 'runs') {

            if (Object.keys(runs).length === 0) {
                return interaction.reply("No active runs.");
            }

            await interaction.reply("**Active Runs:**");

            for (let id in runs) {
                const r = runs[id];
                if (!r) continue;

                const full = r.players.length >= r.max;

                const link = `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${r.messageId}`;

                await interaction.followUp({
                    content:
`👑 Host: <@${r.host}>
👥 Players: ${r.players.length}/${r.max}
Status: ${full ? "FULL" : "Active"}`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel("View")
                                .setStyle(ButtonStyle.Link)
                                .setURL(link)
                        )
                    ]
                });
            }
        }

        // LEAVE COMMAND
        if (interaction.commandName === 'leave') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "You are not in a run.", ephemeral: true });

            await leaveRun(interaction, runId);
            await updateRunMessage(interaction, runId);

            await interaction.reply({ content: "You left the run.", ephemeral: true });
        }

        // END COMMAND
        if (interaction.commandName === 'endrun') {
            const runId = userRuns[interaction.user.id];
            if (!runId) return interaction.reply({ content: "No run.", ephemeral: true });

            const run = runs[runId];
            if (!run || run.host !== interaction.user.id) {
                return interaction.reply({ content: "Only host can end.", ephemeral: true });
            }

            await endRun(interaction, runId);
            await interaction.reply("Run ended.");
        }
    }

    // BUTTONS
    if (interaction.isButton()) {

        const [action, runId] = interaction.customId.split("_");
        const run = runs[runId];
        if (!run) return interaction.reply({ content: "Run not found.", ephemeral: true });

        const user = interaction.user;

        // JOIN
        if (action === "join") {

            if (userRuns[user.id]) {
                return interaction.reply({ content: "You are already in another run.", ephemeral: true });
            }

            if (run.players.length >= run.max) {
                return interaction.reply({ content: "Run is full.", ephemeral: true });
            }

            run.players.push(user.id);
            userRuns[user.id] = runId;

            const channel = await interaction.guild.channels.fetch(run.channelId);
            await channel.permissionOverwrites.edit(user.id, { ViewChannel: true });

            // ✅ UPDATE MAIN MESSAGE
            await updateRunMessage(interaction, runId);

            // ✅ SEND LOG MESSAGE
            const spotsLeft = run.max - run.players.length;

            await interaction.reply({
                content: `<@${user.id}> has been added to <@${run.host}>'s run. There are ${spotsLeft} spots left.`,
                components: [joinOnlyButton(runId, run.players.length >= run.max)]
            });
        }

        // LEAVE
        if (action === "leave") {

            await leaveRun(interaction, runId);
            await updateRunMessage(interaction, runId);

            await interaction.reply({
                content: `${interaction.user} left the run.`
            });
        }

        // END
        if (action === "end") {

            if (run.host !== user.id) {
                return interaction.reply({ content: "Only host can end this run.", ephemeral: true });
            }

            await endRun(interaction, runId);
            await interaction.reply("Run ended.");
        }
    }
});

// FUNCTIONS
async function leaveRun(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const user = interaction.user;

    run.players = run.players.filter(id => id !== user.id);
    delete userRuns[user.id];

    const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
    if (channel) await channel.permissionOverwrites.delete(user.id).catch(() => {});

    if (run.host === user.id) {
        if (run.players.length > 0) {
            run.host = run.players[0];
            if (channel) {
                await channel.permissionOverwrites.edit(run.host, { ViewChannel: true });
                await channel.send(`<@${run.host}> is now the new host.`);
            }
        } else {
            if (channel) await channel.delete().catch(() => {});
            delete runs[runId];
        }
    }
}

async function endRun(interaction, runId) {
    const run = runs[runId];
    if (!run) return;

    const channel = await interaction.guild.channels.fetch(run.channelId).catch(() => null);
    if (channel) await channel.delete().catch(() => {});

    run.players.forEach(u => delete userRuns[u]);
    delete runs[runId];
}

client.login(TOKEN);
