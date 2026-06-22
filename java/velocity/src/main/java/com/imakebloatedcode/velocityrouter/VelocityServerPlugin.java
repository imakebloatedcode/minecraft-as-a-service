package com.imakebloatedcode.velocityrouter;

import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.server.RegisteredServer;

import com.google.inject.Inject;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.util.HashMap;
import java.util.UUID;
import java.util.function.Consumer;

@Plugin(id = "server-api-plugin", name = "ServerApiPlugin")
public class VelocityServerPlugin {

    private final ProxyServer proxy;
    private final EventStreamClient streamClient;

    private HashMap<UUID, String> playerAssignedLocations;

    @Inject
    public VelocityServerPlugin(ProxyServer proxy) throws UnknownHostException, IOException {
        this.proxy = proxy;
        this.streamClient = new EventStreamClient(this);
        this.playerAssignedLocations = new HashMap<UUID, String>();
    }

    @Subscribe
    public void onInit(ProxyInitializeEvent event) {
        streamClient.start();
    }

    @Subscribe
    public void onDisconnect(DisconnectEvent event) throws IOException, Error {
        Player player = event.getPlayer();

        UUID playerId = player.getUniqueId();

        String assignedLocation = playerAssignedLocations.get(playerId);
        playerAssignedLocations.remove(playerId);

        if (assignedLocation == null) {
            throw new Error("Unknown player " + playerId.toString() + " disconnected");
        }

        ApiSentTypes.PlayerDisconnectionEvent message = new ApiSentTypes.PlayerDisconnectionEvent();
        message.userUuid = playerId.toString();
        message.username = player.getUsername();
        message.serverUuid = assignedLocation;

        streamClient.sendMessage(message);

    }

    public void handleKick(UUID uuid, String message) {
        proxy.getPlayer(uuid).ifPresent(player -> player.disconnect(net.kyori.adventure.text.Component.text(message)));
    }

    public void handleSwitch(UUID uuid, String ip, int port, String serverUuid) {
        proxy.getPlayer(uuid).ifPresent(player -> {
            String serverName = ip + "_" + Integer.toString(port);
            Consumer<RegisteredServer> handlePlayer = (RegisteredServer server) -> {
                player.createConnectionRequest(server).connectWithIndication().thenAccept(result -> {
                    // TODO: add event for connection failure
                    if (result) {
                        playerAssignedLocations.put(uuid, serverUuid);
                        ApiSentTypes.PlayerConnectionEvent message = new ApiSentTypes.PlayerConnectionEvent();
                        message.username = player.getUsername();
                        message.userUuid = uuid.toString();
                        message.serverUuid = serverUuid;
                        try {
                            streamClient.sendMessage(message);
                        } catch (IOException e) {
                            e.printStackTrace();
                        }
                    }
                });
            };
            proxy.getServer(serverName).ifPresentOrElse(
                    server -> handlePlayer.accept(server),
                    () -> {
                        ServerInfo info = new ServerInfo(serverName, new InetSocketAddress(ip, port));
                        proxy.registerServer(info);
                        proxy.getScheduler().buildTask(this, () -> {
                            proxy.getServer(serverName).ifPresent(server -> {
                                handlePlayer.accept(server);
                            });
                        }).schedule();
                    });
        });
    }
}