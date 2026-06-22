package com.imakebloatedcode.limboplugin;

import com.loohp.limbo.Limbo;
import com.loohp.limbo.events.Listener;
import com.loohp.limbo.events.player.PlayerJoinEvent;
import com.loohp.limbo.events.player.PlayerQuitEvent;
import com.loohp.limbo.player.Player;
import com.loohp.limbo.plugins.LimboPlugin;
import com.loohp.limbo.scheduler.LimboTask;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.msgpack.jackson.dataformat.MessagePackFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;

public class ConnectionMessagePlugin extends LimboPlugin implements Listener {

    private final Map<UUID, Long> timeouts = new HashMap<>();
    private final HttpClient client = HttpClient.newHttpClient();

    @Override
    public void onEnable() {
        // Register events
        Limbo.getInstance().getEventsManager().registerEvents(this, this);
        // Handle timeouts
        ConnectionMessagePlugin self = this;
        try {
            // Check every 60 ticks
            Limbo.getInstance().getScheduler().runTaskTimer(this, new LimboTask() {
                @Override
                public void run() {
                    for (Map.Entry<UUID, Long> entry : self.timeouts.entrySet()) {
                        if (System.currentTimeMillis() > entry.getValue()) {
                            self.timeouts.remove(entry.getKey());
                            Player player = getServer().getPlayer(entry.getKey());
                            if (player != null) {
                                self.requestToken(player);
                            } else {
                                System.err.println(
                                        "Player was present in the timeouts map but is not connected to the server");
                            }
                        }
                    }
                }
            }, 1L, 60L);

        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @com.loohp.limbo.events.EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        requestToken(player);
    }

    private static class LoginConfig {
        public String loginUrl;
        public Long timeout;
    }

    private static class ErrorResponse {
        public String errorMessage;
    }

    private void requestToken(Player player) {
        UUID uuid = player.getUniqueId();
        getServer().getScheduler().runTaskAsync(this, () -> {
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create("http://runner/api/serverRoute/token?uuid=" + uuid))
                        .GET()
                        .build();

                HttpResponse<byte[]> resp = client.send(req, HttpResponse.BodyHandlers.ofByteArray());

                ObjectMapper mapper = new ObjectMapper(new MessagePackFactory());

                if (resp.statusCode() == 200) {
                    LoginConfig unpacked = mapper.readValue(resp.body(), LoginConfig.class);

                    Component msg = Component.text("Click here to select your server")
                            .color(NamedTextColor.GREEN)
                            .clickEvent(ClickEvent.openUrl(unpacked.loginUrl));

                    player.sendMessage(msg);

                    timeouts.put(uuid, unpacked.timeout);
                } else {
                    ErrorResponse unpacked = mapper.readValue(resp.body(), ErrorResponse.class);
                    System.err.println(unpacked.errorMessage);
                    player.disconnect(unpacked.errorMessage);
                }

            } catch (Exception e) {
                System.err.println(e);
                player.disconnect("Server-side exception\n" + this.stackTrace(e));
            }
        });
    }

    private String stackTrace(Exception t) {
        if (t == null)
            return "Unknown error";

        Throwable root = t;
        while (root.getCause() != null) {
            root = root.getCause();
        }

        String type = root.getClass().getSimpleName();
        String message = root.getMessage();

        return (message == null || message.isBlank())
                ? type
                : type + ": " + message;
    }

    @com.loohp.limbo.events.EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();

        timeouts.remove(uuid);
    }
}