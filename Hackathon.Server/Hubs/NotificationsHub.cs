using Microsoft.AspNetCore.SignalR;

namespace Hackathon.Server.Hubs;

// Demo-mode auth: the client passes ?userId= on the hub URL the same way the
// REST endpoints accept it as a query string. The hub puts the connection into
// a per-user group so the controller can push notifications to "user-{id}".
public class NotificationsHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var raw = Context.GetHttpContext()?.Request.Query["userId"].ToString();
        if (int.TryParse(raw, out var userId) && userId > 0)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(userId));
        }
        await base.OnConnectedAsync();
    }

    public static string GroupFor(int userId) => $"user-{userId}";
}
